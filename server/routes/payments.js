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

  const { items, customerEmail, orderId } = req.body;

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
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${frontendUrl}/order-success/${orderId}`,
      cancel_url: `${frontendUrl}/cart?canceled=true`,
      customer_email: customerEmail,
      metadata: {
        orderId: orderId
      }
    });

    console.log(`[Stripe Debug] Session created: ${session.id}`);
    res.json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('[Stripe API Error]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
