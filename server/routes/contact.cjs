const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/email.cjs');
const { escapeHtml } = require('../utils/order-notify.cjs');

// Initialize Supabase Client (same as orders.js)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

router.get('/', (req, res) => {
  res.send('Contact API is active! 🥖');
});

router.post(['/', '/submit'], async (req, res) => {
  const clip = (v, max) => String(v ?? '').trim().slice(0, max);
  const name = clip(req.body?.name, 100);
  const email = clip(req.body?.email, 200).toLowerCase();
  const message = clip(req.body?.message, 5000);
  const tenantSlug = clip(req.body?.tenantSlug, 100);
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, error: 'Please include your name, a valid email and a message.' });
  }
  console.log(`[Contact] New message for ${tenantSlug || 'platform'}`);

  let recipientEmail = process.env.DEFAULT_CONTACT_EMAIL || 'megan@thedailydough.store';

  // If a tenant slug is provided, try to find the baker's email
  if (tenantSlug && supabase) {
    try {
      const { data: tenant, error: _error } = await supabase
        .from('bakery_tenants')
        .select('email')
        .eq('slug', tenantSlug)
        .single();

      if (tenant && tenant.email) {
        recipientEmail = tenant.email;
      }
    } catch (err) {
      console.error('[Contact] Failed to lookup tenant email:', err);
    }
  }

  // Send Email
  try {
    await sendEmail({
      to: recipientEmail,
      replyTo: email,
      subject: `New Contact Form Submission: ${name.replace(/[\r\n]+/g, ' ')}`,
      text: `You have a new message from your bakery contact form.\n\nFrom: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: `
        <h3>New Contact Form Submission</h3>
        <p><strong>From:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
      `,
    });
    console.log('[Contact] Message emailed to the bakery');
  } catch (error) {
    console.error('[Contact] Error processing email:', error.message);
  }

  res.status(200).json({
    success: true,
    message: 'Message processed successfully'
  });
});

module.exports = router;
