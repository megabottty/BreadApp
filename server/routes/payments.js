const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

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
if (!stripeKey) {
  console.error('MISSING STRIPE_SECRET_KEY: Check your environment variables!');
} else if (stripeKey.startsWith('sk_live')) {
  console.warn('⚠️  WARNING: Using a LIVE Stripe key. Practice orders will use real money!');
} else {
  console.log(`[Stripe Init] Initializing with key: ${stripeKey.substring(0, 7)}...`);
}
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

// POST: Create a Stripe Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured on the server' });
  }

  // FORCE TEST MODE CHECK
  const isLiveKey = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.startsWith('sk_live');
  if (isLiveKey && process.env.NODE_ENV !== 'production') {
    console.error('🛑 BLOCKING LIVE TRANSACTION: You are using a live key in a non-production environment!');
    return res.status(403).json({
      error: 'Live mode blocked for safety. Please use your sk_test_... key in the .env file for development.'
    });
  }

  // Debug check for the current request
  const currentKey = process.env.STRIPE_SECRET_KEY || '';
  console.log(`[Stripe Debug] Creating session using key: ${currentKey.substring(0, 7)}...`);

  const { items, customerEmail, orderId, metadata } = req.body;

  try {
    const lineItems = items.map(item => {
      // Robustly get the price, handling different nested objects if necessary
      const rawPrice = item.price || item.product?.price || 12;
      const amountInCents = Math.round(Number(rawPrice) * 100);

      return {
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name || item.product?.name || 'Artisan Bake',
          },
          unit_amount: amountInCents,
        },
        quantity: item.quantity,
      };
    });

    console.log(`[Stripe Debug] Line Items:`, JSON.stringify(lineItems.map(li => ({ name: li.price_data.product_data.name, qty: li.quantity }))));

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';

    // Build metadata for webhook (combine orderId + custom metadata)
    const sessionMetadata = {
      orderId: orderId || 'webhook-generated',
      ...(metadata || {})
    };

    // Build success URL based on whether we have orderId
    const successUrl = orderId
      ? `${frontendUrl}/order-success/${orderId}`
      : `${frontendUrl}/order-success/pending`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: `${frontendUrl}/cart?canceled=true`,
      customer_email: customerEmail,
      metadata: sessionMetadata
    });

    console.log(`[Stripe Debug] Session created: ${session.id} with metadata:`, sessionMetadata);
    res.json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('[Stripe API Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST: Stripe Webhook Handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured' });
  }

  let event;

  try {
    // Verify webhook signature
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // For development without webhook secret (NOT RECOMMENDED in production)
      console.warn('[Stripe Webhook] No webhook secret configured - accepting unverified webhook');
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error(`[Stripe Webhook Error] ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  console.log(`[Stripe Webhook] Received event: ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`[Stripe Webhook] Payment successful for session: ${session.id}`);
    console.log(`[Stripe Webhook] Metadata:`, session.metadata);

    // Create order from metadata
    const metadata = session.metadata;
    const orderId = metadata.orderId || ('ORD-' + Math.random().toString(36).substring(7).toUpperCase());
    const tenantSlug = metadata.tenantSlug || 'the-daily-dough';
    let tenantId = null;
    if (supabase && tenantSlug) {
      const { data: tenant, error } = await supabase
        .from('bakery_tenants')
        .select('id, slug')
        .eq('slug', tenantSlug)
        .single();
      if (error || !tenant) {
        console.warn(`[Stripe Webhook] Tenant not found for slug: ${tenantSlug}`);
      } else {
        tenantId = tenant.id;
      }
    }

    let parsedItems = [];
    if (metadata.orderItems) {
      try {
        parsedItems = JSON.parse(metadata.orderItems);
      } catch (err) {
        console.warn('[Stripe Webhook] Failed to parse orderItems metadata:', err);
      }
    }

    // Construct order from metadata
    const newOrder = {
      id: orderId,
      customerId: metadata.customerId || 'guest',
      customerName: metadata.customerName || 'Customer',
      customerPhone: metadata.customerPhone || 'UNKNOWN',
      type: metadata.fulfillmentType || 'PICKUP',
      orderSource: metadata.orderSource || 'ONLINE',
      status: 'PENDING',
      paymentStatus: 'PAID',
      pickupDate: metadata.pickupDate,
      tableNumber: metadata.tableNumber,
      notes: metadata.notes,
      subtotal: parseFloat(metadata.subtotal || '0'),
      taxAmount: parseFloat(metadata.taxAmount || '0'),
      totalPrice: session.amount_total / 100, // Stripe amount is in cents
      promoCode: metadata.promoCode,
      discountApplied: parseFloat(metadata.discountApplied || '0'),
      shippingCost: parseFloat(metadata.shippingCost || '0'),
      paymentMethod: {
        brand: session.payment_method_details?.card?.brand || 'card',
        last4: session.payment_method_details?.card?.last4 || '****'
      },
      createdAt: new Date().toISOString()
    };

    console.log(`[Stripe Webhook] Order created:`, newOrder);
    if (supabase && tenantId) {
      const { data, error } = await supabase
        .from('bakery_orders')
        .insert([
          {
            tenant_id: tenantId,
            order_id: newOrder.id,
            customer_name: newOrder.customerName,
            customer_phone: newOrder.customerPhone,
            customer_id: newOrder.customerId,
            total_price: newOrder.totalPrice,
            fulfillment_type: newOrder.type,
            items: parsedItems,
            notes: newOrder.notes,
            pickup_date: newOrder.pickupDate,
            order_source: newOrder.orderSource || 'ONLINE',
            status: newOrder.status || 'PENDING',
            payment_status: newOrder.paymentStatus || 'PAID',
            table_number: newOrder.tableNumber,
            promo_code: newOrder.promoCode,
            discount_applied: newOrder.discountApplied,
            payment_method: newOrder.paymentMethod
          }
        ])
        .select();

      if (error) {
        console.error('[Stripe Webhook] Failed to save order to database:', error.message, error.details);
      } else {
        console.log('[Stripe Webhook] Order saved successfully:', data?.[0]?.id);
      }
    } else {
      console.warn('[Stripe Webhook] Skipping order save (Supabase not configured or tenant missing).');
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
      success_url: `${frontendUrl}/dashboard?payment_setup=success`,
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
