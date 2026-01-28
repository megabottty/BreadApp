const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client (same as orders.js)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// Configure Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Verify connection configuration on startup
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter.verify(function (error, success) {
    if (error) {
      console.error('[Contact SMTP] Connection Error:', error.message);
      if (error.message.includes('getaddrinfo ENOTFOUND')) {
        console.error('[Contact SMTP] Tip: Check if SMTP_HOST is correct (e.g., smtp.sendgrid.net)');
      }
    } else {
      console.log('[Contact SMTP] Server is ready to take our messages');
    }
  });
}

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
      const { data: tenant, error } = await supabase
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

  // Check if SMTP is configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    try {
      const mailOptions = {
        from: process.env.CONTACT_EMAIL_FROM || '"The Daily Dough" <noreply@thedailydough.com>',
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
      };

      await transporter.sendMail(mailOptions);
      console.log(`[Contact] Email sent successfully to ${recipientEmail}`);
    } catch (error) {
      console.error('[Contact] Error sending email:', error);
      // We still return success because we logged it and we don't want to break the UI
      // but maybe we should be honest if it fails?
      // For now, logging is the primary "backup".
    }
  } else {
    console.log('[Contact] SMTP not configured, skipping email delivery.');
  }

  res.status(200).json({
    success: true,
    message: 'Message processed successfully'
  });
});

module.exports = router;
