const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { sendEmail } = require('../utils/email.cjs');
const { normalizePhone } = require('../utils/phone.cjs');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

let client;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
}

router.post('/send-sms', async (req, res) => {
  const { to, message } = req.body;
  const normalizedTo = normalizePhone(to);

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

module.exports = router;
