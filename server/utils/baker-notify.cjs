/**
 * Alerts for the baker herself (new order, orders due, low stock), by text
 * and/or email according to the per-event switches saved on the tenant
 * (`bakery_tenants.notification_settings`). One place decides "does this
 * event go out, and where", so every trigger (order routes, Stripe webhook,
 * daily scheduler) behaves the same.
 */
const twilio = require('twilio');
const { sendEmail } = require('./email.cjs');
const { normalizePhone } = require('./phone.cjs');

const EVENTS = ['newOrder', 'ordersDue', 'lowStock'];

const DEFAULT_EVENTS = {
  newOrder: { sms: true, email: true },
  ordersDue: { sms: true, email: true },
  lowStock: { sms: false, email: true }
};

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = (accountSid && authToken) ? twilio(accountSid, authToken) : null;

/** Merges saved settings with defaults; phone/email fall back to the tenant's public contact details. */
function resolveSettings(tenant) {
  const saved = (tenant && tenant.notification_settings) || {};
  const events = {};
  for (const event of EVENTS) {
    events[event] = { ...DEFAULT_EVENTS[event], ...((saved.events && saved.events[event]) || {}) };
  }
  return {
    phone: saved.phone || (tenant && tenant.phone) || null,
    email: saved.email || (tenant && tenant.email) || null,
    events
  };
}

async function getSettings(supabase, tenantId) {
  const { data: tenant, error } = await supabase
    .from('bakery_tenants')
    .select('id, name, phone, email, notification_settings')
    .eq('id', tenantId)
    .single();
  if (error || !tenant) throw new Error('Bakery not found');
  return { tenant, settings: resolveSettings(tenant) };
}

/** Validates and stores a settings patch ({phone?, email?, events?}). */
async function saveSettings(supabase, tenantId, patch) {
  const { tenant, settings } = await getSettings(supabase, tenantId);
  const next = { ...settings, events: { ...settings.events } };
  if (patch.phone !== undefined) {
    const normalized = patch.phone ? normalizePhone(patch.phone) : null;
    if (patch.phone && !normalized) throw Object.assign(new Error('That phone number doesn\'t look right. Use 10 digits, e.g. 801-555-0123.'), { status: 400 });
    next.phone = normalized;
  }
  if (patch.email !== undefined) next.email = String(patch.email || '').trim() || null;
  if (patch.events && typeof patch.events === 'object') {
    for (const event of EVENTS) {
      const value = patch.events[event];
      if (!value) continue;
      next.events[event] = {
        sms: value.sms !== undefined ? Boolean(value.sms) : next.events[event].sms,
        email: value.email !== undefined ? Boolean(value.email) : next.events[event].email
      };
    }
  }
  const { error } = await supabase
    .from('bakery_tenants')
    .update({ notification_settings: next })
    .eq('id', tenant.id);
  if (error) throw error;
  return next;
}

/**
 * Sends one alert. Never throws: a failed text or email is logged, not
 * bubbled into the order flow that triggered it.
 * @returns {{ sms: boolean, email: boolean, skipped?: string }}
 */
async function notifyBaker(supabase, tenantId, event, { subject, text, html, dryRun = false }) {
  const result = { sms: false, email: false };
  if (!EVENTS.includes(event)) return { ...result, skipped: `unknown event ${event}` };
  let settings;
  try {
    ({ settings } = await getSettings(supabase, tenantId));
  } catch (err) {
    console.warn(`[BakerNotify] ${event}: could not load settings:`, err.message);
    return { ...result, skipped: 'no settings' };
  }
  const want = settings.events[event];
  if (dryRun) return { sms: Boolean(want.sms && settings.phone), email: Boolean(want.email && settings.email), dryRun: true };

  const phone = want.sms ? normalizePhone(settings.phone) : null;
  if (want.sms && phone) {
    if (twilioClient && twilioPhoneNumber) {
      try {
        await twilioClient.messages.create({ body: text, from: twilioPhoneNumber, to: phone });
        result.sms = true;
      } catch (err) {
        console.warn(`[BakerNotify] ${event}: SMS failed:`, err.message);
      }
    } else {
      console.log(`[BakerNotify Mock SMS] ${event} -> ${phone}: ${text}`);
      result.sms = true;
    }
  }
  if (want.email && settings.email) {
    const sent = await sendEmail({
      to: settings.email,
      subject,
      text,
      html: html || `<pre style="font-family:sans-serif;white-space:pre-wrap;">${escapeHtml(text)}</pre>`
    });
    result.email = Boolean(sent && sent.success);
  }
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** Text for a freshly placed order (used by the order route and the Stripe webhook). */
function newOrderText({ orderId, customerName, items, pickupDate, total, paid }) {
  const lines = (items || []).map(item => `- ${item.quantity} × ${item.name}`).join('\n');
  return [
    `🍞 New order #${orderId} from ${customerName || 'a customer'}`,
    pickupDate ? `Pickup: ${pickupDate}` : null,
    total !== undefined ? `Total: $${Number(total).toFixed(2)} (${paid ? 'paid by card' : 'pay at pickup'})` : null,
    lines ? `\n${lines}` : null
  ].filter(Boolean).join('\n');
}

module.exports = { EVENTS, DEFAULT_EVENTS, resolveSettings, getSettings, saveSettings, notifyBaker, newOrderText };
