const express = require('express');
const router = express.Router();
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('MISSING STRIPE_SECRET_KEY: Check your environment variables!');
}
const stripe = stripeKey ? require('stripe')(stripeKey) : null;

// POST: Create a Stripe Checkout Session
router.post('/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe is not configured on the server' });
  }
  const { items, customerEmail, orderId } = req.body;

  try {
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: {
          name: item.name,
        },
        unit_amount: (item.product.price || 12) * 100, // Stripe uses cents
      },
      quantity: item.quantity,
    }));

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${frontendUrl}/profile?success=true&orderId=${orderId}`,
      cancel_url: `${frontendUrl}/cart?canceled=true`,
      customer_email: customerEmail,
      metadata: {
        orderId: orderId
      }
    });

    res.json({ id: session.id, url: session.url });
  } catch (error) {
    console.error('Stripe Session Error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

module.exports = router;
