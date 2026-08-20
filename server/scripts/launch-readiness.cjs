#!/usr/bin/env node
require('dotenv').config();

const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.split('=')[1] : 'test';

if (!['test', 'live'].includes(mode)) {
  console.error('Invalid mode. Use --mode=test or --mode=live');
  process.exit(1);
}

const checks = [];

const addCheck = (label, pass, detail) => {
  checks.push({ label, pass, detail });
};

const has = (name) => Boolean(process.env[name] && String(process.env[name]).trim());
const value = (name) => String(process.env[name] || '').trim();
const masked = (secret) => {
  if (!secret) return 'missing';
  if (secret.length <= 8) return 'set';
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
};

addCheck(
  'SUPABASE_URL configured',
  has('SUPABASE_URL'),
  has('SUPABASE_URL') ? 'ok' : 'missing SUPABASE_URL'
);
addCheck(
  'SUPABASE_SERVICE_KEY configured',
  has('SUPABASE_SERVICE_KEY'),
  has('SUPABASE_SERVICE_KEY') ? 'ok' : 'missing SUPABASE_SERVICE_KEY'
);

const stripeSecretKey = value('STRIPE_SECRET_KEY');
const stripePublicKey = value('STRIPE_PUBLIC_KEY');
const stripeWebhookSecret = value('STRIPE_WEBHOOK_SECRET');

addCheck('STRIPE_SECRET_KEY configured', Boolean(stripeSecretKey), stripeSecretKey ? 'ok' : 'missing');
addCheck('STRIPE_PUBLIC_KEY configured', Boolean(stripePublicKey), stripePublicKey ? 'ok' : 'missing');
addCheck('STRIPE_WEBHOOK_SECRET configured', Boolean(stripeWebhookSecret), stripeWebhookSecret ? 'ok' : 'missing');

if (mode === 'test') {
  addCheck('STRIPE_SECRET_KEY is test key', stripeSecretKey.startsWith('sk_test_'), masked(stripeSecretKey));
  addCheck('STRIPE_PUBLIC_KEY is test key', stripePublicKey.startsWith('pk_test_'), masked(stripePublicKey));
} else {
  addCheck('STRIPE_SECRET_KEY is live key', stripeSecretKey.startsWith('sk_live_'), masked(stripeSecretKey));
  addCheck('STRIPE_PUBLIC_KEY is live key', stripePublicKey.startsWith('pk_live_'), masked(stripePublicKey));
}

addCheck('STRIPE_PRICE_STARTER configured', has('STRIPE_PRICE_STARTER'), has('STRIPE_PRICE_STARTER') ? 'ok' : 'missing');
addCheck('STRIPE_PRICE_PROFESSIONAL configured', has('STRIPE_PRICE_PROFESSIONAL'), has('STRIPE_PRICE_PROFESSIONAL') ? 'ok' : 'missing');
addCheck('STRIPE_PRICE_ENTERPRISE configured', has('STRIPE_PRICE_ENTERPRISE'), has('STRIPE_PRICE_ENTERPRISE') ? 'ok' : 'missing');

addCheck(
  'Twilio SMS credentials configured',
  has('TWILIO_ACCOUNT_SID') && has('TWILIO_AUTH_TOKEN') && has('TWILIO_PHONE_NUMBER'),
  has('TWILIO_ACCOUNT_SID') && has('TWILIO_AUTH_TOKEN') && has('TWILIO_PHONE_NUMBER')
    ? 'ok'
    : 'requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER'
);

addCheck(
  'SMTP credentials configured',
  has('SMTP_HOST') && has('SMTP_USER') && has('SMTP_PASS'),
  has('SMTP_HOST') && has('SMTP_USER') && has('SMTP_PASS')
    ? 'ok'
    : 'requires SMTP_HOST, SMTP_USER, SMTP_PASS'
);

const failed = checks.filter(check => !check.pass);

console.log(`\nLaunch readiness (${mode.toUpperCase()} mode)\n`);
for (const check of checks) {
  const prefix = check.pass ? 'PASS' : 'FAIL';
  console.log(`[${prefix}] ${check.label} - ${check.detail}`);
}

if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nAll checks passed.');
