const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// POST: Create a Stripe Checkout Session
router.post('/create-checkout-session', async (req, res) => {
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL}/profile?success=true&orderId=${orderId}`,
      cancel_url: `${process.env.FRONTEND_URL}/cart?canceled=true`,
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
