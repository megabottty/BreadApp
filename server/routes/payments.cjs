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
const twilio = require('twilio');
const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const twilioClient = (twilioAccountSid && twilioAuthToken)
  ? twilio(twilioAccountSid, twilioAuthToken)
  : null;

const toIso = (unixTs) => (unixTs ? new Date(unixTs * 1000).toISOString() : null);

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
    } else if (process.env.NODE_ENV === 'production') {
      // In production, reject unverified webhooks to avoid forgery
      console.error('[Stripe Webhook] No webhook secret configured in production. Rejecting unverified webhook.');
      return res.status(500).send('Webhook secret not configured');
    } else {
      // For development without webhook secret (NOT RECOMMENDED in production)
      console.warn('[Stripe Webhook] No webhook secret configured - accepting unverified webhook (development only)');
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
      customerEmail: metadata.customerEmail || '',
      notificationPreference: metadata.notificationPreference || 'NONE',
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
      const buildOrderInsert = (includeNotificationFields = true) => ({
        tenant_id: tenantId,
        order_id: newOrder.id,
        customer_name: newOrder.customerName,
        customer_phone: newOrder.customerPhone,
        ...(includeNotificationFields ? {
          customer_email: newOrder.customerEmail,
          notification_preference: newOrder.notificationPreference
        } : {}),
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
      });

      const insertOrder = async (includeNotificationFields = true) => (
        supabase
          .from('bakery_orders')
          .insert([buildOrderInsert(includeNotificationFields)])
          .select()
      );

      let { data, error } = await insertOrder(true);

      if (error && error.code === 'PGRST204') {
        console.warn('[Stripe Webhook] Missing customer_email/notification_preference columns. Retrying insert without them.');
        ({ data, error } = await insertOrder(false));
      }

      if (error) {
        console.error('[Stripe Webhook] Failed to save order to database:', error.message, error.details);
      } else {
        console.log('[Stripe Webhook] Order saved successfully:', data?.[0]?.id);

        try {
          const { data: tenant } = await supabase
            .from('bakery_tenants')
            .select('name, email')
            .eq('id', tenantId)
            .single();

          const recipient = process.env.ORDER_NOTIFICATION_EMAIL
            || tenant?.email
            || process.env.DEFAULT_CONTACT_EMAIL
            || 'meganmuirhead@gmail.com';

        const { sendEmail } = require('../utils/email.cjs');
        const itemsHtml = (parsedItems || []).map(item => `
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${item.name || 'Item'}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${item.quantity || 0}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">$${(item.price || 0).toFixed(2)}</td>
          </tr>
        `).join('');

        await sendEmail({
          to: recipient,
          subject: `New Order: ${newOrder.id}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
              <h2 style="color: #7D8F69;">New Order Received</h2>
              <p><strong>Bakery:</strong> ${tenant?.name || 'Your Bakery'}</p>
              <p><strong>Order ID:</strong> ${newOrder.id}</p>
              <p><strong>Customer:</strong> ${newOrder.customerName || 'Guest'}</p>
              <p><strong>Fulfillment:</strong> ${newOrder.type || 'Pickup'}</p>
              <p><strong>Pickup Date:</strong> ${newOrder.pickupDate || 'N/A'}</p>
              <hr>
              <table style="width: 100%; border-collapse: collapse;">
                <thead>
                  <tr style="background: #f9f9f9;">
                    <th style="text-align: left; padding: 6px 8px;">Item</th>
                    <th style="text-align: left; padding: 6px 8px;">Qty</th>
                    <th style="text-align: left; padding: 6px 8px;">Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml || '<tr><td colspan="3" style="padding: 6px 8px;">No items</td></tr>'}
                </tbody>
              </table>
              <p style="margin-top: 16px;"><strong>Total:</strong> $${(newOrder.totalPrice || 0).toFixed(2)}</p>
            </div>
          `
        });

        const preference = newOrder.notificationPreference || 'NONE';
        const shouldSendEmail = preference === 'EMAIL' || preference === 'BOTH';

        if (shouldSendEmail && newOrder.customerEmail) {
          await sendEmail({
            to: newOrder.customerEmail,
            subject: `Order Confirmation #${newOrder.id}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
                <h2 style="color: #7D8F69;">Thanks for your order!</h2>
                <p>Hi ${newOrder.customerName || 'there'},</p>
                <p>We received your order. Your confirmation number is <strong>#${newOrder.id}</strong>.</p>
                <p>We'll let you know as soon as it's ready.</p>
              </div>
            `
          });
        }

        const shouldSendSms = preference === 'SMS' || preference === 'BOTH';
        if (shouldSendSms && newOrder.customerPhone) {
          if (twilioClient && twilioPhoneNumber) {
            await twilioClient.messages.create({
              body: `Hi ${newOrder.customerName || 'there'}, thanks for your order from The Daily Dough! Your order ID is #${newOrder.id}. We'll notify you when it's ready.`,
              from: twilioPhoneNumber,
              to: newOrder.customerPhone
            });
          } else {
            console.warn('[Order SMS] Twilio not configured. Skipping SMS notification.');
          }
        }
        } catch (emailError) {
          console.error('[Order Email] Failed to send notification:', emailError);
        }
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
