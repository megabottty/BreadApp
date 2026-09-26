/**
 * bakery_notification_preferences helpers shared by the order routes, the
 * Stripe webhook, the notification routes and the scheduler.
 *
 * Select-then-write on purpose (same reasoning as server/utils/pantry.cjs):
 * a partial patch from checkout must never blank a choice the customer made
 * on their notifications page.
 */
const { normalizePhone } = require('./phone.cjs');

const TABLE = 'bakery_notification_preferences';

const DEFAULTS = {
  phone: null,
  email: null,
  weekly_checkin_sms: true,
  weekly_checkin_email: true,
  order_updates_sms: true,
  order_updates_email: true,
  promotions_sms: false,
  promotions_email: true,
  sms_opted_out: false
};

const PATCHABLE = Object.keys(DEFAULTS);

const isRealCustomerId = (id) => typeof id === 'string' && id.length > 8 && id !== 'guest' && id !== 'unknown';

/** Flags implied by the checkout's SMS / EMAIL / BOTH / NONE choice. */
const orderUpdateFlagsFrom = (preference) => {
  const pref = String(preference || '').toUpperCase();
  const sms = pref === 'SMS' || pref === 'BOTH';
  const email = pref === 'EMAIL' || pref === 'BOTH';
  if (!sms && !email) return {};
  return { order_updates_sms: sms, order_updates_email: email };
};

const getPreferences = async (supabase, tenantId, customerId) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

/** Effective preferences: the stored row merged over the defaults. */
const getEffectivePreferences = async (supabase, tenantId, customerId) => {
  const row = await getPreferences(supabase, tenantId, customerId);
  return { ...DEFAULTS, customer_id: customerId, tenant_id: tenantId, ...(row || {}) };
};

/** Create or merge. Only keys present in `patch` are written. */
const upsertPreferences = async (supabase, tenantId, customerId, patch = {}) => {
  if (!isRealCustomerId(customerId) || !tenantId) return null;
  const columns = {};
  for (const key of PATCHABLE) {
    if (patch[key] === undefined) continue;
    if (key === 'phone') columns.phone = patch.phone ? normalizePhone(patch.phone) : null;
    else if (key === 'email') columns.email = patch.email ? String(patch.email).trim().toLowerCase() : null;
    else columns[key] = !!patch[key];
  }
  columns.updated_at = new Date().toISOString();

  const existing = await getPreferences(supabase, tenantId, customerId);
  if (existing) {
    const { data, error } = await supabase
      .from(TABLE)
      .update(columns)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ tenant_id: tenantId, customer_id: customerId, ...columns })
    .select()
    .single();
  if (error) throw error;
  return data;
};

/** Seed contact details from a checkout without clobbering existing choices. */
const seedFromCheckout = async (supabase, tenantId, customerId, { phone, email, notificationPreference }) => {
  if (!isRealCustomerId(customerId) || !tenantId) return null;
  try {
    const existing = await getPreferences(supabase, tenantId, customerId);
    const patch = {};
    const normalized = phone ? normalizePhone(phone) : null;
    if (normalized && (!existing || !existing.phone)) patch.phone = normalized;
    if (email && (!existing || !existing.email)) patch.email = email;
    if (!existing) Object.assign(patch, orderUpdateFlagsFrom(notificationPreference));
    if (Object.keys(patch).length === 0 && existing) return existing;
    return await upsertPreferences(supabase, tenantId, customerId, patch);
  } catch (err) {
    // Missing table on an un-migrated database must never fail an order.
    console.warn('[NotificationPrefs] Could not seed preferences:', err.message);
    return null;
  }
};

module.exports = {
  TABLE,
  DEFAULTS,
  PATCHABLE,
  isRealCustomerId,
  orderUpdateFlagsFrom,
  getPreferences,
  getEffectivePreferences,
  upsertPreferences,
  seedFromCheckout
};
