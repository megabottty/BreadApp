const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { normalizePhone } = require('../utils/phone.cjs');
const bakerNotify = require('../utils/baker-notify.cjs');
const { formatBakeDate } = require('../utils/subscriptions.cjs');
const notificationPrefs = require('../utils/notification-prefs.cjs');
const orderNotify = require('../utils/order-notify.cjs');
const pricing = require('../utils/checkout-pricing.cjs');
const stripeCheckout = require('../utils/stripe-checkout.cjs');
const { optionalUser } = require('../utils/auth.cjs');

const cents = (dollars) => Math.round((Number(dollars) || 0) * 100);

// Initialize Supabase Client (for webhook order creation)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('MISSING SUPABASE CONFIG: Check your environment variables!');
} else if (!process.env.SUPABASE_SERVICE_KEY) {
  console.warn('SUPABASE_SERVICE_KEY not set. Using SUPABASE_KEY which may be blocked by RLS policies.');
}

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;
const stripeKey = process.env.STRIPE_SECRET_KEY;
// Why checkout can't run, in words a person can act on. Surfaced by
// create-checkout-session so the storefront never has to guess.
let stripeConfigProblem = null;
if (!stripeKey) {
  stripeConfigProblem = 'STRIPE_SECRET_KEY is not set on the server.';
  console.error('MISSING STRIPE_SECRET_KEY: Check your environment variables!');
} else if (stripeKey.startsWith('pk_')) {
  stripeConfigProblem = 'STRIPE_SECRET_KEY on the server is a publishable key (pk_...). It must be the secret key (sk_test_... or sk_live_...) from the Stripe dashboard; the publishable key belongs in STRIPE_PUBLIC_KEY.';
  console.error(`[Stripe Init] ${stripeConfigProblem}`);
} else if (!stripeKey.startsWith('sk_')) {
  stripeConfigProblem = 'STRIPE_SECRET_KEY on the server does not look like a Stripe secret key (expected sk_test_... or sk_live_...).';
  console.error(`[Stripe Init] ${stripeConfigProblem}`);
} else if (stripeKey.startsWith('sk_live')) {
  console.warn('⚠️  WARNING: Using a LIVE Stripe key. Practice orders will use real money!');
} else {
  console.log(`[Stripe Init] Initializing with key: ${stripeKey.substring(0, 7)}...`);
}
const stripe = stripeKey && !stripeConfigProblem ? require('stripe')(stripeKey) : null;
const toIso = (unixTs) => (unixTs ? new Date(unixTs * 1000).toISOString() : null);

// Where Stripe sends customers back to. Never fall back to localhost in production.
const frontendUrlOrNull = () => {
  const url = process.env.FRONTEND_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4200');
  return url ? url.replace(/\/$/, '') : null;
};

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'thedailydough';

const resolveCheckoutTenant = async (req, res, next) => {
  if (!supabase) return res.status(500).json({ error: 'Database connection not configured' });
  const slug = String(req.headers['x-tenant-slug'] || DEFAULT_TENANT_SLUG);
  const { data: tenant } = await supabase.from('bakery_tenants').select('id, slug, name').eq('slug', slug).maybeSingle();
  if (!tenant) return res.status(404).json({ error: 'Bakery not found' });
  req.tenant = tenant;
  next();
};

/** Order notices after a card order is saved (one text/email to the customer, the baker's alerts). */
const checkoutNotify = {
  onNewOrder: async (tenantId, order) => {
    bakerNotify.notifyBaker(supabase, tenantId, 'newOrder', {
      subject: `New order #${order.id} from ${order.customerName}`,
      text: bakerNotify.newOrderText({
        orderId: order.id,
        customerName: order.customerName,
        items: order.items,
        pickupDate: order.pickupDate,
        total: order.totalPrice,
        paid: true
      })
    }).catch(err => console.warn('[BakerNotify] newOrder (card) failed:', err.message));
    await notificationPrefs.seedFromCheckout(supabase, tenantId, order.customerId, {
      phone: order.customerPhone,
      email: order.customerEmail,
      notificationPreference: order.notificationPreference
    }).catch(err => console.warn('[Checkout] seed prefs failed:', err.message));
    await orderNotify.sendCustomerConfirmation(order, { skipSms: !!order.subscriptionNoticeSent });
    await orderNotify.sendBakerOrderEmail(supabase, tenantId, order);
  },
  onNewSubscriptions: async (tenantId, order, subs, firstDate) => {
    await orderNotify.sendSubscriptionWelcome(order, subs, formatBakeDate(firstDate));
  }
};

// POST: Create a Stripe Checkout Session. The browser sends what's in the bag
// ({ lines: [{recipeId, packOptionId, quantity, addons, isSubscription}],
// pickupDate, promoCode, customer: {...} }); prices come from the database.
router.post('/create-checkout-session', resolveCheckoutTenant, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: `Card payments are not set up yet: ${stripeConfigProblem || 'Stripe is not configured on the server.'}` });
  }
  const isLiveKey = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_live');
  if (isLiveKey && process.env.NODE_ENV !== 'production') {
    return res.status(403).json({ error: 'Live mode blocked for safety. Use your sk_test_... key in development.' });
  }
  const frontendUrl = frontendUrlOrNull();
  if (!frontendUrl) {
    console.error('[Checkout] FRONTEND_URL is not set; refusing to create a session that would redirect nowhere.');
    return res.status(500).json({ error: 'Card payments are not set up yet. Please choose pay at pickup, or try again later.' });
  }

  try {
    const user = await optionalUser(supabase, req);
    const quote = await pricing.quoteCheckout(supabase, req.tenant.id, req.body || {}, {
      customerId: user ? user.id : null,
      normalizePhone
    });
    // Card orders get a fresh random ID; Stripe sessions are never reused.
    quote.orderId = pricing.newOrderId();

    if (cents(quote.total) < 50) {
      return res.status(400).json({ error: 'Card payments must be at least $0.50. Please choose pay at pickup for this order.' });
    }

    let couponId = null;
    if (quote.discount > 0) {
      const coupon = await stripe.coupons.create({
        amount_off: cents(quote.discount),
        currency: 'usd',
        duration: 'once',
        max_redemptions: 1,
        name: quote.promo ? `Promo ${quote.promo.code}`.slice(0, 40) : 'Loyalty reward'
      });
      couponId = coupon.id;
    }

    const session = await stripe.checkout.sessions.create(stripeCheckout.buildSessionParams({
      quote,
      tenantId: req.tenant.id,
      customerId: user ? user.id : null,
      frontendUrl,
      couponId
    }));
    console.log(`[Checkout] Session ${session.id} for order ${quote.orderId}: $${quote.total.toFixed(2)}`);
    res.json({ id: session.id, url: session.url, orderId: quote.orderId, total: quote.total });
  } catch (error) {
    if (error instanceof pricing.CheckoutError) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error('[Checkout] Session creation failed:', error.message);
    res.status(500).json({ error: 'We couldn\'t start the card payment. Please try again in a moment.' });
  }
});

// POST: Quote the bag (prices, discounts, total) without starting a payment.
// The bag page uses this to show exactly what will be charged.
router.post('/quote', resolveCheckoutTenant, async (req, res) => {
  try {
    const user = await optionalUser(supabase, req);
    const recipesQuote = await pricing.quoteCheckout(supabase, req.tenant.id, req.body || {}, {
      customerId: user ? user.id : null,
      priceOnly: true
    });
    res.json({
      subtotal: recipesQuote.subtotal,
      promoDiscount: recipesQuote.promoDiscount,
      loyaltyDiscount: recipesQuote.loyaltyDiscount,
      discount: recipesQuote.discount,
      total: recipesQuote.total,
      promo: recipesQuote.promo ? { code: recipesQuote.promo.code, description: recipesQuote.promo.description } : null
    });
  } catch (error) {
    if (error instanceof pricing.CheckoutError) return res.status(error.status).json({ error: error.message });
    console.error('[Checkout] Quote failed:', error.message);
    res.status(500).json({ error: 'Could not price your bag right now.' });
  }
});

// GET: Is this checkout paid, and what was ordered? Used by the confirmation
// page. Needs the Stripe session id from the success URL, so it can't be used
// to look up someone else's order. If the webhook hasn't saved the order yet,
// this saves it (same idempotent code path as the webhook).
router.get('/checkout-status', async (req, res) => {
  if (!stripe || !supabase) return res.status(500).json({ error: 'Payments are not configured' });
  const sessionId = String(req.query.session_id || '');
  const orderId = String(req.query.order_id || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Missing checkout session' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || (session.metadata?.orderId && session.metadata.orderId !== orderId)) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (!stripeCheckout.isPaid(session)) return res.json({ paid: false });

    await stripeCheckout.fulfillCheckoutSession({ stripe, supabase, notify: checkoutNotify }, session);
    const { data: row } = await supabase
      .from('bakery_orders')
      .select('order_id, customer_name, customer_phone, customer_email, notification_preference, pickup_date, items, total_price, notes, payment_status, created_at')
      .eq('order_id', session.metadata.orderId)
      .maybeSingle();
    res.json({
      paid: true,
      order: row ? {
        id: row.order_id,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        customerEmail: row.customer_email,
        notificationPreference: row.notification_preference,
        pickupDate: row.pickup_date,
        type: 'PICKUP',
        items: row.items || [],
        totalPrice: Number(row.total_price) || 0,
        notes: row.notes,
        paymentStatus: row.payment_status,
        createdAt: row.created_at
      } : null
    });
  } catch (error) {
    console.error('[Checkout] Status check failed:', error.message);
    res.status(500).json({ error: 'Could not confirm the order yet' });
  }
});

// POST: Stripe Webhook Handler
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  let event;
  try {
    if (webhookSecret) {
      if (!sig) return res.status(400).send('Missing Stripe signature header');
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else if (process.env.NODE_ENV === 'production') {
      console.error('[Stripe Webhook] No webhook secret configured in production. Rejecting unverified webhook.');
      return res.status(500).send('Webhook secret not configured');
    } else {
      console.warn('[Stripe Webhook] No webhook secret configured - accepting unverified webhook (development only)');
      const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
      event = JSON.parse(payload);
    }
  } catch (err) {
    console.error(`[Stripe Webhook Error] ${err.message}`);
    return res.status(400).send('Webhook Error: invalid signature');
  }

  console.log(`[Stripe Webhook] ${event.type} ${event.id}`);

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    if (!supabase) return res.status(500).json({ error: 'Database connection not configured' });
    try {
      const result = await stripeCheckout.fulfillCheckoutSession({ stripe, supabase, notify: checkoutNotify }, session);
      console.log(`[Stripe Webhook] Session ${session.id}: order ${result.orderId} ${result.created ? 'saved' : (result.unpaid ? 'not paid yet' : 'already saved')}`);
    } catch (err) {
      // A paid order we couldn't save: answer 500 so Stripe retries (for up to 3 days).
      console.error(`[Stripe Webhook] FAILED to save paid session ${session.id}:`, err.message);
      return res.status(500).json({ error: 'Order could not be saved; please retry' });
    }
  }

  res.json({ received: true });
});

// POST: Create Setup Session (for adding payment method)
router.post('/create-setup-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  const { tenantId, email } = req.body;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'setup',
      payment_method_types: ['card'],
      success_url: `${frontendUrl}/dashboard?payment_setup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/dashboard?payment_setup=cancelled`,
      customer_email: email,
      metadata: {
        tenantId: tenantId
      }
    });

    console.log(`[Stripe Setup] Setup session created: ${session.id}`);
    res.json({ url: session.url });
  } catch (error) {
    console.error('[Stripe Setup Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST: Confirm setup session and persist Stripe customer on tenant
router.post('/confirm-setup-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }

  const { sessionId, tenantId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.mode !== 'setup') {
      return res.status(400).json({ error: 'Invalid setup session' });
    }

    const resolvedTenantId = tenantId || session.metadata?.tenantId;
    if (!resolvedTenantId) {
      return res.status(400).json({ error: 'tenantId is required' });
    }

    if (session.status !== 'complete') {
      return res.status(400).json({ error: 'Setup session not completed yet' });
    }

    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    if (!customerId) {
      return res.status(400).json({ error: 'No customer found for setup session' });
    }

    const { data, error } = await supabase
      .from('bakery_tenants')
      .update({
        stripe_account_id: customerId,
        subscription_status: 'ACTIVE'
      })
      .eq('id', resolvedTenantId)
      .select()
      .single();

    if (error) {
      console.error('[Stripe Setup Confirm] Failed to persist customer id:', error.message);
      return res.status(500).json({ error: 'Failed to update tenant billing profile' });
    }

    return res.json({
      customerId,
      tenant: data
    });
  } catch (error) {
    console.error('[Stripe Setup Confirm Error]:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

// POST: Create Customer Portal Session (for managing payment methods)
router.post('/create-portal-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  const { customerId } = req.body;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${frontendUrl}/dashboard`
    });

    console.log(`[Stripe Portal] Portal session created for customer: ${customerId}`);
    res.json({ url: session.url });
  } catch (error) {
    console.error('[Stripe Portal Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET: Billing summary (payment method, invoices, next billing)
router.get('/billing-summary/:customerId', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  const { customerId } = req.params;
  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  try {
    const [paymentMethods, invoices, subscriptions] = await Promise.all([
      stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
        limit: 1
      }),
      stripe.invoices.list({
        customer: customerId,
        limit: 10
      }),
      stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 1
      })
    ]);

    const defaultCard = paymentMethods.data[0]?.card
      ? {
        brand: paymentMethods.data[0].card.brand,
        last4: paymentMethods.data[0].card.last4,
        expMonth: paymentMethods.data[0].card.exp_month,
        expYear: paymentMethods.data[0].card.exp_year
      }
      : null;

    const recentInvoices = (invoices.data || []).map(inv => ({
      id: inv.id,
      amountPaid: (inv.amount_paid || 0) / 100,
      currency: inv.currency,
      status: inv.status,
      createdAt: toIso(inv.created),
      invoicePdf: inv.invoice_pdf || null,
      hostedInvoiceUrl: inv.hosted_invoice_url || null
    }));

    const activeSub = subscriptions.data[0] || null;
    const nextBillingDate = activeSub?.current_period_end
      ? toIso(activeSub.current_period_end)
      : null;

    res.json({
      paymentMethod: defaultCard,
      invoices: recentInvoices,
      nextBillingDate,
      subscriptionStatus: activeSub?.status || null
    });
  } catch (error) {
    console.error('[Stripe Billing Summary Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST: Create Subscription with 14-day trial
router.post('/create-subscription', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  const { paymentMethodId, planId, email, tenantId } = req.body;

  try {
    // 1. Create a Customer
    const customer = await stripe.customers.create({
      payment_method: paymentMethodId,
      email: email,
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
      metadata: {
        tenantId: tenantId
      }
    });

    // 2. Map planId to Stripe Price ID
    // TODO: The user should replace these with actual Price IDs from their Stripe Dashboard
    let priceId = '';
    if (planId === 'ENTERPRISE') {
      priceId = process.env.STRIPE_PRICE_ENTERPRISE || 'price_1QqcqeCSuAWgXtUtInProductionExample';
    } else if (planId === 'PROFESSIONAL') {
      priceId = process.env.STRIPE_PRICE_PROFESSIONAL || 'price_1QqcqcCSuAWgXtUtInProductionExample';
    } else {
      priceId = process.env.STRIPE_PRICE_STARTER || 'price_1QqcqBCSuAWgXtUtInProductionExample';
    }

    // Fallback for development if no price ID is provided yet
    if (priceId.includes('Example') && !stripeKey.startsWith('sk_live')) {
       console.warn('[Stripe Warning] Using placeholder Price ID in development.');
    }

    // 3. Create Subscription
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: 14,
      expand: ['latest_invoice.payment_intent'],
    });

    console.log(`[Stripe Debug] Subscription created: ${subscription.id} for customer ${customer.id}`);

    res.json({
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status
    });

  } catch (error) {
    console.error('[Stripe Subscription Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
