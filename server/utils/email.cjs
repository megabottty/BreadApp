const nodemailer = require('nodemailer');

const createTransporter = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

/**
 * replyTo: where a reply goes. Defaults to EMAIL_REPLY_TO, so customers who
 * hit Reply reach a real inbox even when the From address can't receive mail.
 */
const sendEmail = async ({ to, subject, html, text, replyTo }) => {
    const transporter = createTransporter();

    if (!transporter) {
      console.warn('[Email Utility] SMTP not configured. Skipping email.');
      return { success: true, mocked: true };
    }

    try {
      console.log(`[Email Utility] Attempting to send email to ${to}...`);
      const info = await transporter.sendMail({
        from: process.env.CONTACT_EMAIL_FROM || '"The Daily Dough" <noreply@thedailydough.store>',
        to,
        subject,
        html,
        text,
        ...((replyTo || process.env.EMAIL_REPLY_TO) ? { replyTo: replyTo || process.env.EMAIL_REPLY_TO } : {})
      });
      console.log(`[Email Utility] Email sent successfully: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('[Email Utility] Error sending email:', error);
      // We return success: false instead of throwing to allow the caller to decide
      // whether to fail the whole request or not.
      return { success: false, error: error.message };
    }
};

module.exports = {
  createTransporter,
  sendEmail
};
