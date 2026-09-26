/**
 * Bread-subscription date logic and the skip / unskip operations, shared by
 * the customer-facing routes in server/routes/orders.cjs, the inbound-SMS
 * handler in server/routes/notifications.cjs and the scheduler.
 *
 * All dates are 'YYYY-MM-DD' strings handled in UTC so a bake date never
 * shifts by a day depending on the server's timezone.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDate = (dateStr) => new Date(`${dateStr}T00:00:00Z`);
const toDateStr = (date) => date.toISOString().slice(0, 10);

const isDateStr = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

const addDays = (dateStr, n) => toDateStr(new Date(toUtcDate(dateStr).getTime() + n * DAY_MS));

/** The next bake date after `dateStr`: one week on, skipping any skipped dates. */
const nextBakeDateAfter = (dateStr, skippedDates = []) => {
  const skipped = new Set(Array.isArray(skippedDates) ? skippedDates : []);
  let next = addDays(dateStr, 7);
  let guard = 0;
  while (skipped.has(next) && guard < 520) {
    next = addDays(next, 7);
    guard++;
  }
  return next;
};

/** Advance a stale bake date week by week until it is today or later. */
const rollForward = (dateStr, todayStr, skippedDates = []) => {
  let next = dateStr;
  let guard = 0;
  while (next < todayStr && guard < 520) {
    next = nextBakeDateAfter(next, skippedDates);
    guard++;
  }
  return next;
};

/** "Monday, October 6" */
const formatBakeDate = (dateStr) => {
  if (!isDateStr(dateStr)) return String(dateStr || '');
  return toUtcDate(dateStr).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
};

/** 1 = Monday, 2 = Tuesday (UTC day of the 'YYYY-MM-DD' string). */
const weekdayOf = (dateStr) => (isDateStr(dateStr) ? toUtcDate(dateStr).getUTCDay() : null);

/** Today's date in the bakery's timezone as 'YYYY-MM-DD'. */
const todayInDenver = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());

const parseSkipped = (value) => {
  if (Array.isArray(value)) return value.filter(isDateStr);
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.filter(isDateStr) : []; } catch { return []; }
  }
  return [];
};

const weeklyPriceCents = (sub) => Math.round(Number(sub.price || 0) * 100);

/** Credit (negative amount) or debit the Stripe customer balance for one skipped week. Never throws. */
const adjustStripeBalance = async (stripe, sub, amountCents, description) => {
  if (!stripe || !sub.stripe_subscription_id || !amountCents) return null;
  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;
    if (!customerId) return null;
    const tx = await stripe.customers.createBalanceTransaction(customerId, {
      amount: amountCents,
      currency: 'usd',
      description
    });
    console.log(`[Subscriptions] Stripe balance ${amountCents} for ${customerId}: ${tx.id}`);
    return tx.id;
  } catch (err) {
    console.error('[Subscriptions] Stripe balance adjustment failed (skip still applied):', err.message);
    return null;
  }
};

const updateRow = async (supabase, id, patch) => {
  const { data, error } = await supabase
    .from('bakery_subscriptions')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Skip the upcoming bake: record it, move next_bake_date a week on, credit the week on Stripe. */
const skipWeek = async (supabase, stripe, sub) => {
  const skipped = parseSkipped(sub.skipped_dates);
  const skippingDate = sub.next_bake_date;
  if (!isDateStr(skippingDate)) throw new Error('Subscription has no valid next bake date');
  const nextSkipped = skipped.includes(skippingDate) ? skipped : [...skipped, skippingDate];
  const nextDate = nextBakeDateAfter(skippingDate, nextSkipped);

  const row = await updateRow(supabase, sub.id, {
    skipped_dates: nextSkipped,
    next_bake_date: nextDate,
    last_reply: 'SKIP',
    last_reply_at: new Date().toISOString()
  });
  await adjustStripeBalance(stripe, sub, -weeklyPriceCents(sub), `Skipped week of ${formatBakeDate(skippingDate)}`);
  return { ...row, skippedDate: skippingDate };
};

/** Undo the most recent skip, if that week is still ahead of us. */
const unskipWeek = async (supabase, stripe, sub) => {
  const skipped = parseSkipped(sub.skipped_dates);
  if (skipped.length === 0) return sub;
  const restoring = skipped[skipped.length - 1];
  const today = todayInDenver();
  if (restoring < today) {
    const err = new Error('That week has already passed');
    err.status = 400;
    throw err;
  }
  const remaining = skipped.slice(0, -1);
  const nextDate = restoring < sub.next_bake_date ? restoring : sub.next_bake_date;
  const row = await updateRow(supabase, sub.id, {
    skipped_dates: remaining,
    next_bake_date: nextDate,
    last_reply: 'YES',
    last_reply_at: new Date().toISOString()
  });
  await adjustStripeBalance(stripe, sub, weeklyPriceCents(sub), `Un-skipped week of ${formatBakeDate(restoring)}`);
  return { ...row, restoredDate: restoring };
};

module.exports = {
  addDays,
  nextBakeDateAfter,
  rollForward,
  formatBakeDate,
  weekdayOf,
  todayInDenver,
  parseSkipped,
  skipWeek,
  unskipWeek
};
