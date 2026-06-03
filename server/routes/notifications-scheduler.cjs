const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

/**
 * GET /api/notifications/check-prep-alerts
 * Check for orders that need prep in 2 days and send notifications
 */
router.get('/check-prep-alerts', async (req, res) => {
  try {
    console.log('[Prep Alerts] Running daily prep alert check...');

    // Get all pending orders
    const { data: orders, error: ordersError } = await supabase
      .from('bakery_orders')
      .select('*')
      .in('status', ['PENDING', 'READY']);

    if (ordersError) throw ordersError;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Filter orders that are 2 days away
    const upcomingOrders = orders.filter(order => {
      const readyDate = new Date(order.pickup_date || order.created_at);
      readyDate.setHours(0, 0, 0, 0);

      const daysUntil = Math.floor((readyDate - today) / (1000 * 60 * 60 * 24));
      return daysUntil === 2; // Exactly 2 days from now
    });

    if (upcomingOrders.length === 0) {
      console.log('[Prep Alerts] No prep alerts needed today');
      return res.json({
        message: 'No prep alerts needed',
        ordersChecked: orders.length,
        alertsSent: 0
      });
    }

    // Get tenant info for each order to send notifications
    const alertsSent = [];

    for (const order of upcomingOrders) {
      // Get tenant info
      const { data: tenant, error: tenantError } = await supabase
        .from('bakery_tenants')
        .select('*')
        .eq('id', order.tenant_id)
        .single();

      if (tenantError || !tenant) {
        console.warn(`[Prep Alerts] Could not find tenant for order ${order.id}`);
        continue;
      }

      // Calculate starter amount needed
      let starterNeeded = 0;
      // Note: In production, you'd fetch recipes and calculate exact amounts
      // For now, estimate based on number of items
      const itemCount = order.items ? order.items.length : 1;
      starterNeeded = itemCount * 150; // Rough estimate: 150g per item

      // Send notification (email, SMS, or push)
      const notificationSent = await sendPrepNotification({
        tenantEmail: tenant.email,
        tenantPhone: tenant.phone,
        orderId: order.id,
        customerName: order.customer_name,
        readyDate: order.pickup_date,
        starterNeeded,
        items: order.items
      });

      if (notificationSent) {
        alertsSent.push({
          orderId: order.id,
          customer: order.customer_name,
          readyDate: order.pickup_date
        });
      }
    }

    console.log(`[Prep Alerts] Sent ${alertsSent.length} prep alerts`);

    res.json({
      message: `Sent ${alertsSent.length} prep alerts`,
      ordersChecked: orders.length,
      alertsSent: alertsSent.length,
      alerts: alertsSent
    });

  } catch (error) {
    console.error('[Prep Alerts] Error checking prep alerts:', error);
    res.status(500).json({ error: 'Failed to check prep alerts' });
  }
});

/**
 * Send prep notification via email/SMS
 */
async function sendPrepNotification(data) {
  const { tenantEmail: _tenantEmail, tenantPhone: _tenantPhone, orderId, customerName, readyDate, starterNeeded, items } = data;

  const message = `
🥖 PREP ALERT: Order #${orderId}

Customer: ${customerName}
Ready Date: ${new Date(readyDate).toLocaleDateString()}

⚠️ Feed your starter TODAY!
Starter needed: ${starterNeeded}g

Items:
${items ? items.map(item => `- ${item.quantity}x ${item.name}`).join('\n') : ''}

This order needs to be ready in 2 days.
  `.trim();

  console.log('[Prep Alert] Notification:', message);

  // In production, send via Twilio SMS or email
  // For now, just log it
  return true;
}

/**
 * POST /api/notifications/test-prep-alert
 * Test endpoint to manually trigger a prep alert
 */
router.post('/test-prep-alert', async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID required' });
  }

  try {
    const { data: order, error } = await supabase
      .from('bakery_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data: tenant } = await supabase
      .from('bakery_tenants')
      .select('*')
      .eq('id', order.tenant_id)
      .single();

    const notificationSent = await sendPrepNotification({
      tenantEmail: tenant?.email,
      tenantPhone: tenant?.phone,
      orderId: order.id,
      customerName: order.customer_name,
      readyDate: order.pickup_date,
      starterNeeded: 300, // Example amount
      items: order.items
    });

    res.json({
      message: 'Test notification sent',
      orderId: order.id,
      sent: notificationSent
    });

  } catch (error) {
    console.error('[Test Alert] Error:', error);
    res.status(500).json({ error: 'Failed to send test alert' });
  }
});

module.exports = router;
