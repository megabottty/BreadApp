const express = require('express');
const router = express.Router();
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

    // Construct order from metadata
    const newOrder = {
      id: orderId,
      customerId: metadata.customerId || 'guest',
      customerName: metadata.customerName || 'Customer',
      customerPhone: metadata.customerPhone || '',
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

    // TODO: Save order to database
    // For now, just log it
    console.log(`[Stripe Webhook] Order created:`, newOrder);

    // You would typically save to database here:
    // await supabase.from('bakery_orders').insert(newOrder);
  }

  res.json({ received: true });
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
