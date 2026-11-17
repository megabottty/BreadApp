/**
 * Order confirmation messages sent by the server. Both checkout paths (the
 * pay-at-pickup POST in routes/orders.cjs and the Stripe webhook in
 * routes/payments.cjs) send through here, so a customer gets exactly one
 * text and/or one email per order, and the baker gets one order email.
 *
 * Everything a customer typed (name, notes, item names) is HTML-escaped
 * before it goes into an email.
 */
const twilio = require('twilio');
const { sendEmail } = require('./email.cjs');
const { normalizePhone } = require('./phone.cjs');

const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const wantsSms = (pref) => pref === 'SMS' || pref === 'BOTH';
const wantsEmail = (pref) => pref === 'EMAIL' || pref === 'BOTH';

/** Price shown for one order line: lineTotal if the server priced it, else blank. */
const linePrice = (item) => (item.lineTotal != null ? money(item.lineTotal) : '');

const itemsTableHtml = (items) => {
  const rows = (items || []).map(item => `
    <tr>
      <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(item.name || 'Item')}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${escapeHtml(item.packCount ?? item.quantity ?? 0)}</td>
      <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${linePrice(item)}</td>
    </tr>`).join('');
  return `
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr style="background: #f9f9f9;">
          <th style="text-align: left; padding: 6px 8px;">Item</th>
          <th style="text-align: left; padding: 6px 8px;">Qty</th>
          <th style="text-align: left; padding: 6px 8px;">Price</th>
        </tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="3" style="padding: 6px 8px;">No items</td></tr>'}
      </tbody>
    </table>`;
};

const sendSms = async (to, body) => {
  const normalized = normalizePhone(to);
  if (!normalized) return { skipped: 'invalid-phone' };
  if (!twilioClient || !twilioPhoneNumber) {
    console.log('[OrderNotify] Twilio not configured; skipping SMS.');
    return { skipped: 'twilio-not-configured' };
  }
  try {
    const msg = await twilioClient.messages.create({ body, from: twilioPhoneNumber, to: normalized });
    return { sid: msg.sid };
  } catch (err) {
    console.error('[OrderNotify] SMS failed:', err.message);
    return { error: err.message };
  }
};

/**
 * One confirmation to the customer, by text and/or email per their choice.
 * order: { id, customerName, customerPhone, customerEmail, notificationPreference,
 *          pickupDate, items, totalPrice, paymentStatus }
 */
const sendCustomerConfirmation = async (order, { skipSms = false } = {}) => {
  const pref = order.notificationPreference || 'NONE';
  const name = order.customerName || 'there';
  const paidLine = order.paymentStatus === 'PAID' ? 'You\'re all paid.' : 'You can pay when you pick it up.';

  if (!skipSms && wantsSms(pref) && order.customerPhone) {
    await sendSms(
      order.customerPhone,
      `Hi ${name}, thanks for your order from The Daily Dough! Order #${order.id}` +
      (order.pickupDate ? ` for pickup ${order.pickupDate}` : '') +
      `. ${paidLine} We'll text you when it's ready.`
    );
  }

  if (wantsEmail(pref) && order.customerEmail) {
    await sendEmail({
      to: order.customerEmail,
      subject: `Order confirmation #${order.id}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #7D8F69;">Thanks for your order!</h2>
          <p>Hi ${escapeHtml(name)},</p>
          <p>Your confirmation number is <strong>#${escapeHtml(order.id)}</strong>.</p>
          ${order.pickupDate ? `<p><strong>Pickup:</strong> ${escapeHtml(order.pickupDate)}</p>` : ''}
          ${itemsTableHtml(order.items)}
          <p style="margin-top: 16px;"><strong>Total:</strong> ${money(order.totalPrice)}</p>
          <p>${escapeHtml(paidLine)} We'll let you know as soon as it's ready.</p>
        </div>`
    });
  }
};

/** The order email to the bakery (separate from baker-notify's text/email switches). */
const sendBakerOrderEmail = async (supabase, tenantId, order) => {
  let tenant = null;
  try {
    ({ data: tenant } = await supabase.from('bakery_tenants').select('name, email').eq('id', tenantId).single());
  } catch { /* fall through to env fallbacks */ }

  const recipient = process.env.ORDER_NOTIFICATION_EMAIL || tenant?.email || process.env.DEFAULT_CONTACT_EMAIL;
  if (!recipient) {
    console.warn('[OrderNotify] No bakery email configured; skipping baker order email.');
    return;
  }

  await sendEmail({
    to: recipient,
    subject: `New Order: ${order.id}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
        <h2 style="color: #7D8F69;">New Order Received</h2>
        <p><strong>Bakery:</strong> ${escapeHtml(tenant?.name || 'Your Bakery')}</p>
        <p><strong>Order ID:</strong> ${escapeHtml(order.id)}</p>
        <p><strong>Customer:</strong> ${escapeHtml(order.customerName || 'Guest')}</p>
        <p><strong>Payment:</strong> ${order.paymentStatus === 'PAID' ? 'Paid by card' : 'Pay at pickup'}</p>
        <p><strong>Pickup Date:</strong> ${escapeHtml(order.pickupDate || 'N/A')}</p>
        ${order.notes ? `<p><strong>Notes:</strong> ${escapeHtml(order.notes)}</p>` : ''}
        <hr>
        ${itemsTableHtml(order.items)}
        <p style="margin-top: 16px;"><strong>Total:</strong> ${money(order.totalPrice)}</p>
      </div>`
  });
};

/** The one text a new subscriber gets (instead of the plain order confirmation text). */
const sendSubscriptionWelcome = async (order, subs, firstDateLabel) => {
  if (!wantsSms(order.notificationPreference) || !order.customerPhone || subs.length === 0) return;
  const what = subs.length === 1 ? `${subs[0].quantity} × ${subs[0].recipe_name}` : `${subs.length} weekly bakes`;
  await sendSms(
    order.customerPhone,
    `Hi ${order.customerName || 'there'}, it's Megan at The Daily Dough 🍞 Your weekly subscription for ${what} is confirmed ` +
    `(order #${order.id}). First pickup: ${firstDateLabel}. I'll text you each Thursday to confirm or skip.`
  );
};

module.exports = { escapeHtml, sendCustomerConfirmation, sendBakerOrderEmail, sendSubscriptionWelcome };
