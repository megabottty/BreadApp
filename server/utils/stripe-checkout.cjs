/**
 * Card checkout with Stripe Checkout (hosted page).
 *
 * buildSessionParams: a priced quote (checkout-pricing.cjs) -> Stripe session
 *   params. Line items carry their own recipe/pack details in product
 *   metadata, so nothing about the bag has to fit in session metadata.
 *
 * fulfillCheckoutSession: a completed session -> exactly one bakery_orders row
 *   (+ one bakery_subscriptions row per weekly line). Safe to run more than
 *   once for the same session: the webhook, Stripe's retries, and the
 *   confirmation page's check all call it. Throws if the order can't be
 *   saved, so the webhook answers 500 and Stripe tries again.
 */
const { todayInDenver, addDays, weekdayOf, formatBakeDate } = require('./subscriptions.cjs');
const { normalizePhone } = require('./phone.cjs');

const cents = (dollars) => Math.round((Number(dollars) || 0) * 100);
const meta = (value, max = 490) => String(value ?? '').slice(0, max);

const buildSessionParams = ({ quote, tenantId, customerId, frontendUrl, couponId }) => {
  const mode = quote.hasSubscription ? 'subscription' : 'payment';
  const metadata = {
    orderId: quote.orderId,
    tenantId,
    customerId: customerId || 'guest',
    customerName: meta(quote.customer.name),
    customerPhone: meta(quote.customer.phone),
    customerEmail: meta(quote.customer.email),
    notificationPreference: quote.customer.notificationPreference,
    fulfillmentType: 'PICKUP',
    pickupDate: quote.pickupDate,
    notes: meta(quote.customer.notes),
    promoCode: quote.promo ? quote.promo.code : '',
    discountApplied: String(quote.discount),
    subtotal: String(quote.subtotal)
  };

  const lineItems = quote.lines.map(line => ({
    quantity: line.packCount,
    price_data: {
      currency: 'usd',
      unit_amount: cents(line.unitPrice),
      ...(line.isSubscription && mode === 'subscription' ? { recurring: { interval: 'week' } } : {}),
      product_data: {
        name: line.name.slice(0, 250),
        metadata: {
          recipeId: String(line.recipeId),
          packSize: String(line.packSize),
          packWeightGrams: String(Math.round(line.weightGrams / line.packCount)),
          sub: line.isSubscription ? '1' : '0'
        }
      }
    }
  }));

  return {
    mode,
    payment_method_types: ['card'],
    line_items: lineItems,
    ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
    success_url: `${frontendUrl}/order-success/${quote.orderId}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${frontendUrl}/cart?canceled=true`,
    ...(quote.customer.email ? { customer_email: quote.customer.email } : {}),
    metadata,
    ...(mode === 'payment' ? { payment_intent_data: { metadata } } : { subscription_data: { metadata } })
  };
};

/** Order lines from the session's own line items (falls back to the old orderItems metadata). */
const readOrderItems = async (stripe, session) => {
  const result = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100, expand: ['data.price.product'] });
  const items = [];
  for (const li of result.data || []) {
    const product = li.price && typeof li.price.product === 'object' ? li.price.product : null;
    const pm = (product && product.metadata) || {};
    const packCount = Number(li.quantity) || 1;
    const packSize = Number(pm.packSize) || 1;
    items.push({
      recipeId: pm.recipeId || '',
      name: li.description || (product && product.name) || 'Item',
      packCount,
      packSize,
      quantity: packCount * packSize,
      unitPrice: (li.price?.unit_amount || 0) / 100,
      lineTotal: (li.amount_subtotal || 0) / 100,
      isSubscription: pm.sub === '1' || Boolean(li.price?.recurring),
      weightGrams: (Number(pm.packWeightGrams) || 0) * packCount
    });
  }
  const hasRecipeIds = items.some(i => i.recipeId);
  if (!hasRecipeIds && session.metadata && session.metadata.orderItems) {
    // A session started before server-side pricing shipped.
    try {
      const legacy = JSON.parse(session.metadata.orderItems);
      if (Array.isArray(legacy) && legacy.length) return legacy;
    } catch { /* use the Stripe lines */ }
  }
  return items;
};

const readCard = async (stripe, session) => {
  try {
    if (!session.payment_intent) return null;
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id;
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
    const card = pi.latest_charge && pi.latest_charge.payment_method_details && pi.latest_charge.payment_method_details.card;
    return card ? { brand: card.brand, last4: card.last4 } : null;
  } catch (err) {
    console.warn('[Checkout] Could not read card details:', err.message);
    return null;
  }
};

const resolveTenantId = async (supabase, md) => {
  if (md.tenantId) return md.tenantId;
  // Sessions from before tenantId was stored: try the slug the browser sent, then both historic defaults.
  for (const slug of [md.tenantSlug, 'thedailydough', 'the-daily-dough'].filter(Boolean)) {
    const { data } = await supabase.from('bakery_tenants').select('id').eq('slug', slug).maybeSingle();
    if (data) return data.id;
  }
  return null;
};

const isPaid = (session) =>
  session.payment_status === 'paid' || (session.status === 'complete' && session.payment_status === 'no_payment_required');

/**
 * deps: { stripe, supabase, notify } where notify is an object with
 *   onNewOrder(tenantId, order) and onNewSubscriptions(tenantId, order, subs, firstDate)
 * Returns { orderId, created: boolean }.
 */
const fulfillCheckoutSession = async (deps, session) => {
  const { stripe, supabase, notify } = deps;
  if (!isPaid(session)) return { orderId: session.metadata?.orderId || null, created: false, unpaid: true };

  const md = session.metadata || {};
  const orderId = md.orderId && md.orderId !== 'webhook-generated' ? md.orderId : `DD-S${session.id.slice(-12).toUpperCase()}`;
  const tenantId = await resolveTenantId(supabase, md);
  if (!tenantId) throw new Error(`No bakery found for paid session ${session.id}`);

  const { data: existing, error: existingErr } = await supabase
    .from('bakery_orders').select('id').eq('order_id', orderId).maybeSingle();
  if (existingErr) throw new Error(`Order lookup failed: ${existingErr.message}`);

  const items = await readOrderItems(stripe, session);
  const customerEmail = md.customerEmail || session.customer_details?.email || session.customer_email || '';
  const order = {
    id: orderId,
    customerId: md.customerId || 'guest',
    customerName: md.customerName || session.customer_details?.name || 'Customer',
    customerPhone: md.customerPhone || '',
    customerEmail,
    notificationPreference: md.notificationPreference || 'EMAIL',
    type: 'PICKUP',
    pickupDate: md.pickupDate || null,
    notes: md.notes || '',
    items,
    totalPrice: (session.amount_total || 0) / 100,
    promoCode: md.promoCode || null,
    discountApplied: Number(md.discountApplied || 0),
    paymentStatus: 'PAID'
  };

  let created = false;
  if (!existing) {
    const paymentMethod = await readCard(stripe, session);
    const row = (withNotificationFields) => ({
      tenant_id: tenantId,
      order_id: order.id,
      customer_name: order.customerName,
      customer_phone: order.customerPhone,
      ...(withNotificationFields ? { customer_email: order.customerEmail, notification_preference: order.notificationPreference } : {}),
      customer_id: order.customerId,
      total_price: order.totalPrice,
      fulfillment_type: 'PICKUP',
      items: order.items,
      notes: order.notes,
      pickup_date: order.pickupDate,
      order_source: 'ONLINE',
      status: 'PENDING',
      payment_status: 'PAID',
      promo_code: order.promoCode,
      discount_applied: order.discountApplied,
      payment_method: paymentMethod
    });
    let { error } = await supabase.from('bakery_orders').insert([row(true)]);
    if (error && error.code === 'PGRST204') ({ error } = await supabase.from('bakery_orders').insert([row(false)]));
    if (error && error.code !== '23505') throw new Error(`Order insert failed: ${error.message}`);
    created = !error;
    // 23505: another request (webhook vs. confirmation page) saved it a moment
    // ago and is creating the subscriptions too, so leave those to it.
    if (error) return { orderId, tenantId, created: false };
  }

  // Weekly subscriptions: one row per recurring line, created once per Stripe subscription.
  if (session.mode === 'subscription' && session.subscription) {
    const stripeSubId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const { data: existingSubs, error: subLookupErr } = await supabase
      .from('bakery_subscriptions').select('id').eq('stripe_subscription_id', stripeSubId).limit(1);
    if (subLookupErr) throw new Error(`Subscription lookup failed: ${subLookupErr.message}`);
    if (!existingSubs || existingSubs.length === 0) {
      const today = todayInDenver();
      const firstDate = /^\d{4}-\d{2}-\d{2}$/.test(order.pickupDate || '') ? order.pickupDate : addDays(today, 7);
      const weekday = weekdayOf(firstDate);
      const rows = items.filter(i => i.isSubscription).map(i => ({
        tenant_id: tenantId,
        customer_id: order.customerId,
        recipe_id: i.recipeId || null,
        recipe_name: i.name,
        quantity: i.packCount,
        frequency: 'WEEKLY',
        price: Number(i.lineTotal.toFixed(2)),
        start_date: today,
        next_bake_date: firstDate,
        pickup_weekday: weekday === 1 || weekday === 2 ? weekday : null,
        customer_name: order.customerName,
        customer_email: customerEmail || null,
        customer_phone: normalizePhone(order.customerPhone),
        stripe_subscription_id: stripeSubId,
        skipped_dates: [],
        status: 'ACTIVE'
      }));
      if (rows.length > 0) {
        const { data: subs, error: subErr } = await supabase.from('bakery_subscriptions').insert(rows).select();
        if (subErr) throw new Error(`Subscription insert failed: ${subErr.message}`);
        if (notify && notify.onNewSubscriptions) {
          await notify.onNewSubscriptions(tenantId, order, subs || [], firstDate)
            .catch(err => console.error('[Checkout] subscription notice failed:', err.message));
        }
        order.subscriptionNoticeSent = true;
      }
    }
  }

  if (created && notify && notify.onNewOrder) {
    await notify.onNewOrder(tenantId, order)
      .catch(err => console.error('[Checkout] order notices failed:', err.message));
  }

  return { orderId, tenantId, created };
};

module.exports = { buildSessionParams, fulfillCheckoutSession, isPaid, readOrderItems, formatBakeDate };
