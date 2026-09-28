const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { sendEmail } = require('../utils/email.cjs');
const bakerNotify = require('../utils/baker-notify.cjs');
const { normalizePhone } = require('../utils/phone.cjs');
const notificationPrefs = require('../utils/notification-prefs.cjs');
const subscriptions = require('../utils/subscriptions.cjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://thedailydough.store').replace(/\/$/, '');

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Weekday (0-6) in the bakery's timezone. */
const denverWeekday = () => {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', weekday: 'long' }).format(new Date()).toLowerCase();
  return WEEKDAY_NAMES.indexOf(name);
};

/** SUBSCRIPTION_CHECKIN_DAY accepts a name ("thursday") or 0-6. Default Thursday. */
const checkinWeekday = () => {
  const raw = String(process.env.SUBSCRIPTION_CHECKIN_DAY || 'thursday').trim().toLowerCase();
  if (/^\d$/.test(raw)) return Number(raw);
  const idx = WEEKDAY_NAMES.indexOf(raw);
  return idx === -1 ? 4 : idx;
};

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/**
 * GET /api/notifications/check-prep-alerts
 * Check for orders that need prep in 2 days and send notifications
 */
router.get('/check-prep-alerts', async (req, res) => {
  try {
    const result = await runPrepAlerts({ dryRun: req.query.dryRun === '1' });
    res.json(result);
  } catch (error) {
    console.error('[Prep Alerts] Error checking prep alerts:', error);
    res.status(500).json({ error: 'Failed to check prep alerts' });
  }
});

async function runPrepAlerts({ dryRun = false } = {}) {
  console.log('[Prep Alerts] Running daily prep alert check...');

  // Get all pending orders
  const { data: orders, error: ordersError } = await supabase
    .from('bakery_orders')
    .select('*')
    .in('status', ['PENDING', 'READY']);

  if (ordersError) throw ordersError;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter orders that are 2 days away
  const upcomingOrders = (orders || []).filter(order => {
    const readyDate = new Date(order.pickup_date || order.created_at);
    readyDate.setHours(0, 0, 0, 0);

    const daysUntil = Math.floor((readyDate - today) / (1000 * 60 * 60 * 24));
    return daysUntil === 2; // Exactly 2 days from now
  });

  if (upcomingOrders.length === 0) {
    console.log('[Prep Alerts] No prep alerts needed today');
    return {
      message: 'No prep alerts needed',
      ordersChecked: (orders || []).length,
      alertsSent: 0
    };
  }

  // Get tenant info for each order to send notifications
  const alertsSent = [];

  for (const order of upcomingOrders) {
    // Get tenant info
    const { data: tenant, error: tenantError } = await supabase
      .from('bakery_tenants')
      .select('*')
      .eq('id', order.tenant_id)
      .single();

    if (tenantError || !tenant) {
      console.warn(`[Prep Alerts] Could not find tenant for order ${order.id}`);
      continue;
    }

    // Calculate starter amount needed
    // Note: In production, you'd fetch recipes and calculate exact amounts
    // For now, estimate based on number of items
    const itemCount = order.items ? order.items.length : 1;
    const starterNeeded = itemCount * 150; // Rough estimate: 150g per item

    const notificationSent = await sendPrepNotification({
      tenantId: tenant.id,
      orderId: order.order_id || order.id,
      customerName: order.customer_name,
      readyDate: order.pickup_date,
      starterNeeded,
      items: order.items,
      dryRun
    });

    if (notificationSent) {
      alertsSent.push({
        orderId: order.order_id || order.id,
        customer: order.customer_name,
        readyDate: order.pickup_date
      });
    }
  }

  console.log(`[Prep Alerts] Sent ${alertsSent.length} prep alerts`);

  return {
    message: `Sent ${alertsSent.length} prep alerts`,
    ordersChecked: (orders || []).length,
    alertsSent: alertsSent.length,
    alerts: alertsSent
  };
}

/**
 * Prep notification to the baker, by text/email per her "orders due" switches.
 */
async function sendPrepNotification(data) {
  const { tenantId, orderId, customerName, readyDate, starterNeeded, items, dryRun } = data;

  const message = `
🥖 PREP ALERT: Order #${orderId}

Customer: ${customerName}
Ready Date: ${new Date(readyDate).toLocaleDateString()}

⚠️ Feed your starter TODAY!
Starter needed: ${starterNeeded}g

Items:
${items ? items.map(item => `- ${item.quantity}x ${item.name}`).join('\n') : ''}

This order needs to be ready in 2 days.
  `.trim();

  console.log('[Prep Alert] Notification:', message);
  const result = await bakerNotify.notifyBaker(supabase, tenantId, 'ordersDue', {
    subject: `Prep alert: order #${orderId} is ready in 2 days`,
    text: message,
    dryRun
  });
  return Boolean(result.sms || result.email || result.dryRun);
}

/**
 * Morning digest of everything due for pickup today, per bakery.
 */
async function runTodayPickups({ today, dryRun }) {
  const { data: orders, error } = await supabase
    .from('bakery_orders')
    .select('tenant_id, order_id, id, customer_name, items, pickup_date, status')
    .eq('pickup_date', today)
    .in('status', ['PENDING', 'READY']);
  if (error) throw error;
  const byTenant = new Map();
  for (const order of orders || []) {
    if (!byTenant.has(order.tenant_id)) byTenant.set(order.tenant_id, []);
    byTenant.get(order.tenant_id).push(order);
  }
  const sent = [];
  for (const [tenantId, list] of byTenant) {
    const lines = list.map(o => `- #${o.order_id || o.id} ${o.customer_name}: ${(o.items || []).map(i => `${i.quantity}× ${i.name}`).join(', ')}`).join('\n');
    const text = `🍞 ${list.length} pickup${list.length === 1 ? '' : 's'} today (${today}):\n${lines}`;
    const result = await bakerNotify.notifyBaker(supabase, tenantId, 'ordersDue', { subject: `${list.length} pickup(s) today`, text, dryRun });
    sent.push({ tenantId, orders: list.length, ...result });
  }
  return { tenants: byTenant.size, sent };
}

/**
 * Low-stock digest: any inventory item under its threshold, per bakery.
 * Sent daily while something is low (a fresh reminder until it's restocked).
 */
async function runLowStock({ dryRun }) {
  const { data: items, error } = await supabase
    .from('bakery_inventory')
    .select('tenant_id, ingredient_name, current_stock, unit, min_stock_threshold')
    .gt('min_stock_threshold', 0);
  if (error) throw error;
  const low = (items || []).filter(i => Number(i.current_stock) < Number(i.min_stock_threshold));
  const byTenant = new Map();
  for (const item of low) {
    if (!byTenant.has(item.tenant_id)) byTenant.set(item.tenant_id, []);
    byTenant.get(item.tenant_id).push(item);
  }
  const sent = [];
  for (const [tenantId, list] of byTenant) {
    const lines = list.map(i => `- ${i.ingredient_name}: ${Number(i.current_stock)}${i.unit || 'g'} left (min ${Number(i.min_stock_threshold)}${i.unit || 'g'})`).join('\n');
    const text = `📦 Running low on ${list.length} ingredient${list.length === 1 ? '' : 's'}:\n${lines}\n\nRestock before the next bake.`;
    const result = await bakerNotify.notifyBaker(supabase, tenantId, 'lowStock', { subject: `Low stock: ${list.map(i => i.ingredient_name).join(', ')}`, text, dryRun });
    sent.push({ tenantId, items: list.length, ...result });
  }
  return { lowItems: low.length, sent };
}

/**
 * POST /api/notifications/test-prep-alert
 * Test endpoint to manually trigger a prep alert
 */
router.post('/test-prep-alert', async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID required' });
  }

  try {
    const { data: order, error } = await supabase
      .from('bakery_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data: tenant } = await supabase
      .from('bakery_tenants')
      .select('*')
      .eq('id', order.tenant_id)
      .single();

    const notificationSent = await sendPrepNotification({
      tenantEmail: tenant?.email,
      tenantPhone: tenant?.phone,
      orderId: order.order_id || order.id,
      customerName: order.customer_name,
      readyDate: order.pickup_date,
      starterNeeded: 300, // Example amount
      items: order.items
    });

    res.json({
      message: 'Test notification sent',
      orderId: order.id,
      sent: notificationSent
    });

  } catch (error) {
    console.error('[Test Alert] Error:', error);
    res.status(500).json({ error: 'Failed to send test alert' });
  }
});

// ---------------------------------------------------------------------------
// Daily run (called by .github/workflows/notification-scheduler.yml)
// ---------------------------------------------------------------------------

/** (a) Move stale bake dates forward so nobody's "next pickup" is in the past. */
async function rollDatesForward({ today, dryRun }) {
  const { data: subs, error } = await supabase
    .from('bakery_subscriptions')
    .select('id, next_bake_date, skipped_dates')
    .eq('status', 'ACTIVE')
    .lt('next_bake_date', today);
  if (error) throw error;

  const rolled = [];
  for (const sub of subs || []) {
    const next = subscriptions.rollForward(sub.next_bake_date, today, subscriptions.parseSkipped(sub.skipped_dates));
    if (next === sub.next_bake_date) continue;
    rolled.push({ id: sub.id, from: sub.next_bake_date, to: next });
    if (!dryRun) {
      await supabase.from('bakery_subscriptions').update({ next_bake_date: next }).eq('id', sub.id);
    }
  }
  return { rolled: rolled.length, details: rolled };
}

const checkinSmsText = (sub) =>
  `Hi ${firstName(sub.customer_name)}, it's Megan at The Daily Dough 🍞 Your ${sub.quantity} × ${sub.recipe_name} is set for pickup ${subscriptions.formatBakeDate(sub.next_bake_date)}. Reply YES to confirm or SKIP to skip this week (you won't be charged for it). Reply STOP to stop these texts.`;

const checkinEmailHtml = (sub) => `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;border:1px solid #eee;">
    <h2 style="color:#7D8F69;">Your bread this week 🍞</h2>
    <p>Hi ${firstName(sub.customer_name)}, it's Megan at The Daily Dough.</p>
    <p>Your <strong>${sub.quantity} × ${sub.recipe_name}</strong> is set for pickup <strong>${subscriptions.formatBakeDate(sub.next_bake_date)}</strong>.</p>
    <p>Nothing to do if that works for you. Need to skip this week? You won't be charged for it:</p>
    <p><a href="${PUBLIC_URL}/subscriptions" style="display:inline-block;background:#7D8F69;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;">Manage my subscription</a></p>
    <p style="color:#888;font-size:12px;">You're getting this because you have a weekly bread subscription. Change how you hear from me at ${PUBLIC_URL}/profile.</p>
  </div>`;

/** (b) Thursday check-in: one text/email per subscription per bake date. */
async function sendWeeklyCheckins({ today, dryRun, force }) {
  const weekday = denverWeekday();
  if (!force && weekday !== checkinWeekday()) {
    return { skipped: `not check-in day (today is ${WEEKDAY_NAMES[weekday]})`, sent: { sms: 0, email: 0 } };
  }

  const horizon = subscriptions.addDays(today, 7);
  const { data: subs, error } = await supabase
    .from('bakery_subscriptions')
    .select('*')
    .eq('status', 'ACTIVE')
    .gte('next_bake_date', today)
    .lte('next_bake_date', horizon);
  if (error) throw error;

  const sent = { sms: 0, email: 0 };
  const details = [];
  for (const sub of subs || []) {
    if (sub.last_reminder_for === sub.next_bake_date) continue;
    let prefs;
    try {
      prefs = await notificationPrefs.getEffectivePreferences(supabase, sub.tenant_id, sub.customer_id);
    } catch {
      prefs = { ...notificationPrefs.DEFAULTS };
    }
    const phone = normalizePhone(prefs.phone || sub.customer_phone);
    const email = prefs.email || sub.customer_email;
    const doSms = prefs.weekly_checkin_sms && !prefs.sms_opted_out && !!phone;
    const doEmail = prefs.weekly_checkin_email && !!email;
    const entry = { id: sub.id, bakeDate: sub.next_bake_date, sms: false, email: false };

    if (doSms) {
      if (dryRun) entry.sms = true;
      else if (twilioClient && twilioPhoneNumber) {
        try {
          await twilioClient.messages.create({ body: checkinSmsText(sub), from: twilioPhoneNumber, to: phone });
          entry.sms = true;
        } catch (err) {
          console.warn('[Check-in] SMS failed:', phone, err.message);
        }
      } else {
        console.log(`[Check-in Mock SMS] ${phone}: ${checkinSmsText(sub)}`);
        entry.sms = true;
      }
    }
    if (doEmail) {
      if (dryRun) entry.email = true;
      else {
        const result = await sendEmail({ to: email, subject: 'Your bread this week 🍞', text: checkinSmsText(sub), html: checkinEmailHtml(sub) });
        entry.email = !!(result && result.success);
      }
    }

    if (entry.sms) sent.sms++;
    if (entry.email) sent.email++;
    if ((entry.sms || entry.email) && !dryRun) {
      await supabase.from('bakery_subscriptions').update({ last_reminder_for: sub.next_bake_date }).eq('id', sub.id);
    }
    details.push(entry);
  }
  return { sent, considered: (subs || []).length, details };
}

/**
 * POST /api/notifications-scheduler/run
 * Guarded by the x-scheduler-secret header. ?dryRun=1 reports without sending.
 * ?forceCheckin=1 runs the weekly check-in regardless of the weekday.
 */
router.post('/run', async (req, res) => {
  const secret = process.env.SCHEDULER_SECRET;
  if (!secret) return res.status(503).json({ error: 'SCHEDULER_SECRET is not configured on the server' });
  if (req.header('x-scheduler-secret') !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query.dryRun === '1';
  const force = req.query.forceCheckin === '1';
  const today = subscriptions.todayInDenver();
  const summary = { today, dryRun, jobs: {} };

  const jobs = [
    ['rollDates', () => rollDatesForward({ today, dryRun })],
    ['weeklyCheckin', () => sendWeeklyCheckins({ today, dryRun, force })],
    ['prepAlerts', () => runPrepAlerts({ dryRun })],
    ['todayPickups', () => runTodayPickups({ today, dryRun })],
    ['lowStock', () => runLowStock({ dryRun })]
  ];
  for (const [name, job] of jobs) {
    try {
      summary.jobs[name] = await job();
    } catch (err) {
      console.error(`[Scheduler] ${name} failed:`, err.message);
      summary.jobs[name] = { error: err.message };
    }
  }
  console.log('[Scheduler] Run complete:', JSON.stringify(summary));
  res.json(summary);
});

module.exports = router;
