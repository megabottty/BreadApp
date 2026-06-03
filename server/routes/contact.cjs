const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('../utils/email.cjs');

// Initialize Supabase Client (same as orders.js)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

router.get('/', (req, res) => {
  res.send('Contact API is active! 🥖');
});

router.post(['/', '/submit'], async (req, res) => {
  const { name, email, message, tenantSlug } = req.body;

  console.log('--- NEW CONTACT FORM SUBMISSION ---');
  console.log(`Bakery (Tenant): ${tenantSlug || 'Platform'}`);
  console.log(`From: ${name} <${email}>`);
  console.log(`Message: ${message}`);
  console.log('-----------------------------------');

  let recipientEmail = process.env.DEFAULT_CONTACT_EMAIL || 'admin@thedailydough.com';

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
        console.log(`[Contact] Found baker email: ${recipientEmail}`);
      }
    } catch (err) {
      console.error('[Contact] Failed to lookup tenant email:', err);
    }
  }

  // Send Email
  try {
    await sendEmail({
      to: recipientEmail,
      subject: `New Contact Form Submission: ${name}`,
      text: `You have a new message from your bakery contact form.\n\nFrom: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: `
        <h3>New Contact Form Submission</h3>
        <p><strong>From:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    });
    console.log(`[Contact] Email processed for ${recipientEmail}`);
  } catch (error) {
    console.error('[Contact] Error processing email:', error);
  }

  res.status(200).json({
    success: true,
    message: 'Message processed successfully'
  });
});

module.exports = router;
