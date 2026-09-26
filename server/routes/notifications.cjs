const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/email.cjs');
const { normalizePhone } = require('../utils/phone.cjs');
const { requireCustomer, requireBaker } = require('../utils/auth.cjs');
const notificationPrefs = require('../utils/notification-prefs.cjs');
const subscriptions = require('../utils/subscriptions.cjs');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const stripeSecret = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecret.startsWith('sk_') ? require('stripe')(stripeSecret) : null;

const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://thedailydough.store').replace(/\/$/, '');

// This router has no tenant middleware of its own (see orders.cjs); resolve
// the slug header only on the routes that need a tenant.
const resolveTenant = async (req, res, next) => {
  if (!supabase) return res.status(500).json({ error: 'Database connection not configured' });
  const slug = req.headers['x-tenant-slug'];
  if (!slug) return res.status(400).json({ error: 'x-tenant-slug header is required' });
  try {
    const { data: tenant, error } = await supabase
      .from('bakery_tenants')
      .select('id, slug, name')
      .eq('slug', slug)
      .single();
    if (error || !tenant) return res.status(404).json({ error: 'Bakery not found' });
    req.tenantId = tenant.id;
    req.tenant = tenant;
    next();
  } catch {
    res.status(500).json({ error: 'Tenant lookup failed' });
  }
};

router.post('/send-sms', async (req, res) => {
  const { to, message, customerId } = req.body;
  const normalizedTo = normalizePhone(to);

  // Honour a signed-in customer's "order updates by text" choice when the
  // caller tells us who they are. Older callers omit customerId: unchanged.
  if (supabase && customerId && req.headers['x-tenant-slug'] && notificationPrefs.isRealCustomerId(customerId)) {
    try {
      const { data: tenant } = await supabase.from('bakery_tenants').select('id').eq('slug', req.headers['x-tenant-slug']).single();
      if (tenant) {
        const prefs = await notificationPrefs.getEffectivePreferences(supabase, tenant.id, customerId);
        if (prefs.sms_opted_out || prefs.order_updates_sms === false) {
          console.log(`[Twilio] Skipping SMS to ${normalizedTo || to}: customer opted out of order texts`);
          return res.status(200).json({ success: true, skipped: 'opted-out' });
        }
      }
    } catch (err) {
      console.warn('[Twilio] Preference check failed, sending anyway:', err.message);
    }
  }

  if (!client || !twilioPhoneNumber) {
    console.log(`[Twilio Mock - Missing Credentials] To: ${normalizedTo || to}, Msg: ${message}`);
    return res.status(200).json({ success: true, mocked: true });
  }

  if (!normalizedTo) {
    console.warn(`[Twilio] Invalid/missing phone number: "${to}"`);
    return res.status(200).json({ success: true, mocked: true, warning: 'Invalid phone number' });
  }

  try {
    const response = await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: normalizedTo
    });
    console.log(`[Twilio] SMS sent to ${normalizedTo}: ${response.sid}`);
    res.json({ success: true, sid: response.sid });
  } catch (error) {
    if (error.code === 21211 || error.status === 400) {
      console.warn(`[Twilio Warning] Suppressing error for invalid/mock phone number: ${normalizedTo}`);
      return res.status(200).json({ success: true, mocked: true, warning: 'Invalid phone number' });
    }

    console.error('Twilio Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/send-email', async (req, res) => {
  const { to, subject, html } = req.body;

  try {
    const result = await sendEmail({ to, subject, html });
    // Even if email fails, we return 200 with success: false to avoid triggering the error interceptor
    // as the notification is often a non-critical secondary action for the UI.
    // If result.success is false, we still return 200.
    res.status(200).json(result);
  } catch (error) {
    console.error('[Notifications Route] Unexpected error:', error);
    res.status(200).json({ success: false, error: error.message });
  }
});

// ---------------------------------------------------------------------------
// Notification preferences (signed-in customers)
// ---------------------------------------------------------------------------

router.get('/preferences', resolveTenant, requireCustomer(supabase), async (req, res) => {
  try {
    const prefs = await notificationPrefs.getEffectivePreferences(supabase, req.tenantId, req.customerId);
    res.json(prefs);
  } catch (error) {
    console.error('[NotificationPrefs] Load failed:', error.message);
    res.status(500).json({ error: 'Failed to load notification preferences' });
  }
});

router.put('/preferences', resolveTenant, requireCustomer(supabase), async (req, res) => {
  const body = req.body || {};
  if (body.phone && !normalizePhone(body.phone)) {
    return res.status(400).json({ error: 'That phone number doesn\'t look right. Use 10 digits, e.g. 801-555-0123.' });
  }
  try {
    const patch = {};
    for (const key of notificationPrefs.PATCHABLE) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    // Turning texts back on from the settings page clears a STOP opt-out
    // only when the customer explicitly asks for it (sms_opted_out: false).
    const row = await notificationPrefs.upsertPreferences(supabase, req.tenantId, req.customerId, patch);
    const merged = { ...notificationPrefs.DEFAULTS, customer_id: req.customerId, tenant_id: req.tenantId, ...(row || {}) };
    res.json(merged);
  } catch (error) {
    console.error('[NotificationPrefs] Save failed:', error.message);
    res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

// ---------------------------------------------------------------------------
// Promotions: the baker sends a text/email to everyone who opted in
// ---------------------------------------------------------------------------

router.post('/promotion', resolveTenant, requireBaker(supabase), async (req, res) => {
  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();
  const channels = Array.isArray(req.body?.channels) ? req.body.channels : ['sms', 'email'];
  const wantSms = channels.includes('sms');
  const wantEmail = channels.includes('email');
  if (!message) return res.status(400).json({ error: 'A message is required' });
  if (wantEmail && !subject) return res.status(400).json({ error: 'A subject is required for email' });

  try {
    const { data: rows, error } = await supabase
      .from(notificationPrefs.TABLE)
      .select('*')
      .eq('tenant_id', req.tenantId);
    if (error) throw error;

    const bakery = req.tenant?.name || 'The Daily Dough';
    const sent = { sms: 0, email: 0 };
    let skipped = 0;
    const seenPhones = new Set();
    const seenEmails = new Set();

    for (const row of rows || []) {
      let did = false;
      const phone = row.phone ? normalizePhone(row.phone) : null;
      if (wantSms && row.promotions_sms && !row.sms_opted_out && phone && !seenPhones.has(phone)) {
        seenPhones.add(phone);
        if (client && twilioPhoneNumber) {
          try {
            await client.messages.create({ body: `${message}\n\nReply STOP to stop texts from ${bakery}.`, from: twilioPhoneNumber, to: phone });
            sent.sms++; did = true;
          } catch (err) { console.warn('[Promotion] SMS failed:', phone, err.message); }
        } else {
          console.log(`[Promotion Mock SMS] ${phone}: ${message}`);
          sent.sms++; did = true;
        }
      }
      if (wantEmail && row.promotions_email && row.email && !seenEmails.has(row.email)) {
        seenEmails.add(row.email);
        const result = await sendEmail({
          to: row.email,
          subject,
          text: message,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2 style="color:#7D8F69;">${bakery}</h2><p style="white-space:pre-line;">${message}</p><p style="color:#888;font-size:12px;">You're getting this because you opted in to news from ${bakery}. Manage your preferences at ${PUBLIC_URL}/profile.</p></div>`
        });
        if (result && result.success) { sent.email++; did = true; }
      }
      if (!did) skipped++;
    }

    res.json({ sent, skipped, recipients: (rows || []).length });
  } catch (error) {
    console.error('[Promotion] Send failed:', error.message);
    res.status(500).json({ error: 'Failed to send the promotion' });
  }
});

// ---------------------------------------------------------------------------
// Inbound SMS (Twilio webhook): YES / SKIP / STOP / START replies to the
// weekly check-in. Configure the number's messaging webhook to
// POST {PUBLIC_URL}/api/notifications/sms-inbound.
// ---------------------------------------------------------------------------

const twiml = (text) => {
  const response = new twilio.twiml.MessagingResponse();
  response.message(text);
  return response.toString();
};

const HELP_REPLY = 'Reply YES to confirm this week\'s bread, SKIP to skip it, or STOP to stop texts.';

router.post('/sms-inbound', async (req, res) => {
  res.type('text/xml');

  if (authToken) {
    const signature = req.header('X-Twilio-Signature') || '';
    const fullUrl = `${PUBLIC_URL}/api/notifications/sms-inbound`;
    const valid = twilio.validateRequest(authToken, signature, fullUrl, req.body || {});
    if (!valid) {
      console.warn('[SMS Inbound] Rejected request with a bad Twilio signature');
      return res.status(403).send('Forbidden');
    }
  } else {
    console.warn('[SMS Inbound] TWILIO_AUTH_TOKEN not set; accepting unsigned request');
  }

  if (!supabase) return res.status(200).send(twiml('Sorry, the bakery is having trouble right now. Please try again later.'));

  const from = normalizePhone(req.body?.From);
  const body = String(req.body?.Body || '').trim().toUpperCase();
  const word = body.split(/\s+/)[0] || '';

  try {
    // STOP/START affect every bakery this phone is known to, before we even
    // look for a subscription.
    if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(word) || word === 'START') {
      const optOut = word !== 'START';
      if (from) {
        await supabase.from(notificationPrefs.TABLE).update({ sms_opted_out: optOut, updated_at: new Date().toISOString() }).eq('phone', from);
      }
      return res.status(200).send(twiml(optOut
        ? 'You won\'t get texts from The Daily Dough anymore. Reply START to resume.'
        : 'Welcome back! You\'ll get texts from The Daily Dough again. ' + HELP_REPLY));
    }

    if (!from) return res.status(200).send(twiml(HELP_REPLY));

    const { data: subs, error } = await supabase
      .from('bakery_subscriptions')
      .select('*')
      .eq('customer_phone', from)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const sub = subs && subs[0];

    if (!sub) {
      return res.status(200).send(twiml('Hi! I couldn\'t find an active bread subscription for this number. Manage yours at ' + PUBLIC_URL + '/subscriptions or reply STOP to stop texts.'));
    }

    if (['YES', 'Y', 'CONFIRM', 'OK'].includes(word)) {
      await supabase.from('bakery_subscriptions')
        .update({ last_reply: 'YES', last_reply_at: new Date().toISOString() })
        .eq('id', sub.id);
      return res.status(200).send(twiml(`Perfect, see you ${subscriptions.formatBakeDate(sub.next_bake_date)}! 🍞`));
    }

    if (['SKIP', 'S', 'NO', 'N', 'PAUSE'].includes(word)) {
      const updated = await subscriptions.skipWeek(supabase, stripe, sub);
      return res.status(200).send(twiml(`Got it, skipping ${subscriptions.formatBakeDate(updated.skippedDate)}. Your next pickup is ${subscriptions.formatBakeDate(updated.next_bake_date)}.`));
    }

    return res.status(200).send(twiml(HELP_REPLY));
  } catch (err) {
    console.error('[SMS Inbound] Failed:', err.message);
    return res.status(200).send(twiml('Sorry, something went wrong on my end. ' + HELP_REPLY));
  }
});

module.exports = router;
