const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
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

const toDateString = (date) => date.toISOString().split('T')[0];

const sumQuantities = (items = []) => items.reduce((sum, item) => sum + (item.quantity || 0), 0);

const allocateItemRevenue = (order, item, totalUnits) => {
  if (!totalUnits) return 0;
  return (order.total_price || 0) * ((item.quantity || 0) / totalUnits);
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Middleware to extract tenant_id from headers
const tenantMiddleware = async (req, res, next) => {
  if (req.url === '/register-bakery' || req.method === 'OPTIONS') {
    return next();
  }

  const tenantSlug = req.headers['x-tenant-slug'];
  if (!tenantSlug) {
    if (req.url === '/info') {
      return res.status(400).json({ error: 'x-tenant-slug header is required for /info' });
    }
    console.warn(`[Tenant Middleware] Missing x-tenant-slug header for ${req.method} ${req.originalUrl}`);
    req.tenantId = null;
    return next();
  }

  try {
    const { data: tenant, error } = await supabase
      .from('bakery_tenants')
      .select('id, slug')
      .eq('slug', tenantSlug)
      .single();

    if (error || !tenant) {
      if (tenantSlug !== 'thedailydough') {
        console.warn(`[Tenant Middleware] Bakery not found for slug: "${tenantSlug}". Ensure the bakery is registered.`);
      }

      // If it's the /info route, we want to return the 404 with a specific message
      if (req.url === '/info') {
        return res.status(404).json({ error: 'Bakery not found' });
      }

      // For other routes, we might want to continue but with null tenantId
      // OR return 404. Given current logic, we return 404.
      return res.status(404).json({ error: 'Bakery not found' });
    }

    req.tenantId = tenant.id;
    console.log(`[Tenant Middleware] Identified tenant: ${tenant.slug} (${tenant.id}) for ${req.method} ${req.originalUrl}`);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Tenant lookup failed' });
  }
};

router.use(tenantMiddleware);

// POST: Place a new order
router.post('/', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const orderData = req.body;

  try {
    console.log('[Supabase Debug] Attempting to save order:', orderData.id, 'for tenant:', req.tenantId);
    const buildOrderInsert = (includeNotificationFields = true) => ({
      tenant_id: req.tenantId,
      order_id: orderData.id,
      customer_name: orderData.customerName,
      customer_phone: orderData.customerPhone,
      ...(includeNotificationFields ? {
        customer_email: orderData.customerEmail,
        notification_preference: orderData.notificationPreference
      } : {}),
      customer_id: orderData.customerId,
      total_price: orderData.totalPrice,
      fulfillment_type: orderData.type,
      items: orderData.items,
      notes: orderData.notes,
      pickup_date: orderData.pickupDate,
      order_source: orderData.orderSource || 'ONLINE',
      status: orderData.status || 'PENDING',
      payment_status: orderData.paymentStatus || 'PENDING',
      table_number: orderData.tableNumber,
      promo_code: orderData.promoCode,
      discount_applied: orderData.discountApplied,
      payment_method: orderData.paymentMethod
    });

    const insertOrder = async (includeNotificationFields = true) => (
      supabase
        .from('bakery_orders')
        .insert([buildOrderInsert(includeNotificationFields)])
        .select()
    );

    let { data, error } = await insertOrder(true);

    if (error && error.code === 'PGRST204') {
      console.warn('[Supabase Warning] Missing customer_email/notification_preference columns. Retrying insert without them.');
      ({ data, error } = await insertOrder(false));
    }

    if (error) {
      console.error('[Supabase Error] Order Insert Failed:', error.message, error.details);
      throw error;
    }
    console.log('[Supabase Debug] Order saved successfully:', data[0].id);

    try {
      const { data: tenant } = await supabase
        .from('bakery_tenants')
        .select('name, email')
        .eq('id', req.tenantId)
        .single();

      const recipient = process.env.ORDER_NOTIFICATION_EMAIL
        || tenant?.email
        || process.env.DEFAULT_CONTACT_EMAIL
        || 'meganmuirhead@gmail.com';

        console.log('[Order Email] Debug config:', {
          smtpHost: process.env.SMTP_HOST ? 'set' : 'missing',
          smtpUser: process.env.SMTP_USER ? 'set' : 'missing',
          smtpPass: process.env.SMTP_PASS ? 'set' : 'missing',
          smtpPort: process.env.SMTP_PORT || '587',
          smtpSecure: process.env.SMTP_SECURE === 'true',
          from: process.env.CONTACT_EMAIL_FROM || 'default',
          recipient
        });

        const { sendEmail } = require('../utils/email.cjs');
        const itemsHtml = (orderData.items || []).map(item => `
          <tr>
            <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${item.name || 'Item'}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${item.quantity || 0}</td>
            <td style="padding: 6px 8px; border-bottom: 1px solid #eee;">$${(item.price || 0).toFixed(2)}</td>
          </tr>
        `).join('');

        await sendEmail({
          to: recipient,
          subject: `New Order: ${orderData.id}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
              <h2 style="color: #7D8F69;">New Order Received</h2>
              <p><strong>Bakery:</strong> ${tenant?.name || 'Your Bakery'}</p>
              <p><strong>Order ID:</strong> ${orderData.id}</p>
              <p><strong>Customer:</strong> ${orderData.customerName || 'Guest'}</p>
              <p><strong>Fulfillment:</strong> ${orderData.type || 'Pickup'}</p>
              <p><strong>Pickup Date:</strong> ${orderData.pickupDate || 'N/A'}</p>
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
              <p style="margin-top: 16px;"><strong>Total:</strong> $${(orderData.totalPrice || 0).toFixed(2)}</p>
            </div>
          `
        });
    } catch (emailError) {
      console.error('[Order Email] Failed to send notification:', emailError);
    }

    res.status(201).json({
      message: 'Order saved to the cloud! ☁️🥖',
      order: data[0]
    });
  } catch (error) {
    console.error('Error saving order:', error);
    res.status(500).json({ error: 'Failed to save order to database' });
  }
});

// --- NEW RECIPE ROUTES ---

// GET: All recipes
router.get('/recipes', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    let query = supabase.from('bakery_recipes').select('*');
    if (req.tenantId) {
      query = query.eq('tenant_id', req.tenantId);
    } else {
      console.warn('[Supabase Warning] Recipes requested but tenantId is missing from request.');
      return res.status(400).json({ error: 'Tenant not identified' });
    }

    let { data, error } = await query;
    if (error && error.message.includes('tenant_id') && error.message.includes('does not exist')) {
      console.warn('[Supabase Warning] bakery_recipes.tenant_id is missing. Falling back to global recipe query.');
      ({ data, error } = await supabase.from('bakery_recipes').select('*'));
    }

    if (error) {
      console.error('[Supabase Error] Fetch Recipes Failed:', error.message);
      const isMissingTable =
        error.code === 'PGRST205' ||
        (error.message.includes('relation') && error.message.includes('bakery_recipes')) ||
        (error.message.includes('Could not find the table') && error.message.includes('bakery_recipes'));
      if (isMissingTable) {
        // Older databases may not have the recipes table yet. Keep POS usable instead of hard-failing.
        return res.json([]);
      }
      throw error;
    }

    // Map database snake_case to frontend camelCase
    const formattedRecipes = data.map(recipe => ({
      id: recipe.id,
      name: recipe.name,
      category: recipe.category,
      price: recipe.price,
      description: recipe.description,
      trueHydration: recipe.true_hydration,
      flavorProfile: recipe.flavor_profile,
      isHidden: recipe.is_hidden,
      ingredients: recipe.ingredients,
      images: recipe.images,
      available_addons: recipe.available_addons,
      sku: recipe.sku,
      barcode: recipe.barcode,
      product_type: recipe.product_type,
      prepTimeMinutes: recipe.prep_time_minutes,
      bakeTimeMinutes: recipe.bake_time_minutes,
      createdAt: recipe.created_at
    }));

    res.json(formattedRecipes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// GET: Ingredient cost defaults
router.get('/ingredients/costs', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  try {
    const { data, error } = await supabase
      .from('bakery_ingredient_costs')
      .select('*')
      .eq('tenant_id', req.tenantId);

    if (error) {
      console.error('[Supabase Error] Fetch Ingredient Costs Failed:', error.message);
      return res.status(500).json({ error: 'Failed to fetch ingredient costs', details: error.message });
    }

    const formatted = (data || []).map(item => ({
      name: item.name,
      bulkPrice: item.bulk_price,
      bulkWeight: item.bulk_weight,
      costPerUnit: item.cost_per_unit,
      updatedAt: item.updated_at
    }));

    res.json(formatted);
  } catch (error) {
    console.error('Error fetching ingredient costs:', error);
    res.status(500).json({ error: 'Failed to fetch ingredient costs' });
  }
});

// POST: Upsert ingredient cost defaults
router.post('/ingredients/costs', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  const costs = Array.isArray(req.body) ? req.body : [];
  if (costs.length === 0) {
    return res.status(400).json({ error: 'No ingredient costs provided' });
  }

  const payload = costs
    .filter(item => item?.name)
    .map(item => ({
      tenant_id: req.tenantId,
      name: item.name,
      bulk_price: item.bulkPrice ?? null,
      bulk_weight: item.bulkWeight ?? null,
      cost_per_unit: item.costPerUnit ?? null,
      updated_at: new Date().toISOString()
    }));

  if (payload.length === 0) {
    return res.status(400).json({ error: 'No valid ingredient costs provided' });
  }

  try {
    const { data, error } = await supabase
      .from('bakery_ingredient_costs')
      .upsert(payload, { onConflict: 'tenant_id,name' })
      .select();

    if (error) {
      console.error('[Supabase Error] Upsert Ingredient Costs Failed:', error.message);
      return res.status(500).json({ error: 'Failed to save ingredient costs', details: error.message });
    }

    res.json({ updated: data?.length || 0 });
  } catch (error) {
    console.error('Error saving ingredient costs:', error);
    res.status(500).json({ error: 'Failed to save ingredient costs' });
  }
});

// GET: Bakery Info
router.get('/info', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    console.warn('[Supabase Warning] Bakery info requested but tenantId is missing from request.');
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  try {
    const { data, error } = await supabase
      .from('bakery_tenants')
      .select('*')
      .eq('id', req.tenantId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bakery info' });
  }
});

// PATCH: Update Bakery Info (Branding, Oven, Subscription, etc)
router.patch('/info', async (req, res) => {
  console.log('[Tenant Debug] PATCH /api/orders/info hit');
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const updates = req.body;
  const tenantId = req.headers['x-tenant-id'];

  console.log('[Tenant Debug] Updating tenant ID:', tenantId, 'with data:', updates);

  if (!tenantId) {
    console.warn('[Tenant Warning] Missing x-tenant-id header');
    return res.status(400).json({ error: 'Tenant ID is required for updates' });
  }

  try {
    const { data, error } = await supabase
      .from('bakery_tenants')
      .update(updates)
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.error('[Supabase Error] Bakery Update Failed:', error.message, 'Code:', error.code);
      // Check for missing column error
      if (error.code === '42703') {
        return res.status(400).json({
          error: 'Database schema mismatch',
          message: 'The column "onboarding_completed" is missing. Please run the SQL update command provided.'
        });
      }
      throw error;
    }

    console.log('[Tenant Debug] Update successful for:', data.slug);
    res.json(data);
  } catch (error) {
    console.error('Error updating bakery info:', error);
    res.status(500).json({ error: 'Failed to update bakery info', details: error.message });
  }
});

// POST: Register a new bakery
router.post('/register-bakery', async (req, res) => {
  console.log('[DEBUG LOG] POST /api/orders/register-bakery hit with body:', req.body);
  if (!supabase) {
    console.error('[Supabase Error] Database connection not configured');
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { name, slug } = req.body;
  if (!name || !slug) {
    console.warn('[Validation Warning] Missing name or slug in registration');
    return res.status(400).json({ error: 'Name and slug are required' });
  }

  try {
    console.log('[Supabase Debug] Registering bakery:', name, 'with slug:', slug);
    const { data, error } = await supabase
      .from('bakery_tenants')
      .insert([{ name, slug }])
      .select()
      .single();

    if (error) {
      console.error('[Supabase Error] Bakery Registration Failed:', error.message, 'Code:', error.code, 'Details:', error.details);

      // Check for missing table error
      if (error.message && error.message.includes("Could not find the table 'public.bakery_tenants'")) {
        return res.status(500).json({
          error: 'Database table missing. Please ensure you have run the latest supabase_schema.sql in your Supabase SQL Editor.'
        });
      }

      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ error: `The slug "${slug}" is already taken. Please choose another one.` });
      }
      return res.status(500).json({ error: error.message || 'Unknown database error' });
    }

    console.log('[Supabase Debug] Bakery registered successfully:', data.id);
    res.status(201).json(data);
  } catch (error) {
    console.error('[Server Error] Unexpected error during bakery registration:', error);
    res.status(500).json({ error: 'An unexpected server error occurred while registering your bakery.' });
  }
});

// POST: Save/Update recipe
router.post('/recipes', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const recipe = req.body;
  try {
    console.log('[Supabase Debug] Attempting to save recipe:', recipe.name, 'for tenant:', req.tenantId);
    const { data, error } = await supabase
      .from('bakery_recipes')
      .upsert({
        id: (recipe.id && recipe.id.length > 15) ? recipe.id : undefined,
        tenant_id: req.tenantId,
        name: recipe.name,
        category: recipe.category,
        price: recipe.price,
        description: recipe.description,
        true_hydration: recipe.trueHydration,
        flavor_profile: recipe.flavorProfile,
        is_hidden: recipe.isHidden,
        ingredients: recipe.ingredients,
        images: recipe.images,
        available_addons: recipe.available_addons,
        sku: recipe.sku,
        barcode: recipe.barcode,
        product_type: recipe.productType || 'PHYSICAL',
        prep_time_minutes: recipe.prepTimeMinutes,
        bake_time_minutes: recipe.bakeTimeMinutes
      })
      .select();

    if (error) {
      console.error('[Supabase Error] Recipe Upsert Failed:', error.message, error.details);
      return res.status(500).json({ error: 'Failed to save recipe', details: error.message, code: error.code });
    }
    console.log('[Supabase Debug] Recipe saved successfully:', data[0].id);
    res.json(data[0]);
  } catch (error) {
    console.error('Error saving recipe:', error);
    res.status(500).json({ error: 'Failed to save recipe', details: error.message, stack: error.stack });
  }
});

// DELETE: Remove a recipe
router.delete('/recipes/:id', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { id } = req.params;
  try {
    console.log('[Supabase Debug] Attempting to delete recipe:', id);
    const { error } = await supabase
      .from('bakery_recipes')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Supabase Error] Recipe Deletion Failed:', error.message);
      throw error;
    }

    console.log('[Supabase Debug] Recipe deleted successfully:', id);
    res.json({ message: 'Recipe deleted successfully', id });
  } catch (error) {
    console.error('Error deleting recipe:', error);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});

// --- INVENTORY ROUTES ---

// GET: All inventory for tenant
router.get('/inventory', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }
  try {
    const { data, error } = await supabase
      .from('bakery_inventory')
      .select('*')
      .eq('tenant_id', req.tenantId);

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// POST: Update inventory stock
router.post('/inventory', async (req, res) => {
  console.log('[Inventory Debug] POST /api/orders/inventory hit with body:', req.body);
  if (!supabase) {
    console.error('[Inventory Error] Database connection not configured');
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    console.warn('[Inventory Warning] Tenant not identified for inventory update');
    return res.status(400).json({ error: 'Tenant not identified' });
  }
  const { ingredient_name, current_stock, min_stock_threshold } = req.body;
  try {
    console.log('[Inventory Debug] Upserting for tenant:', req.tenantId, 'ingredient:', ingredient_name);
    const { data, error } = await supabase
      .from('bakery_inventory')
      .upsert({
        tenant_id: req.tenantId,
        ingredient_name,
        current_stock,
        min_stock_threshold,
        last_updated: new Date().toISOString()
      }, { onConflict: 'tenant_id, ingredient_name' })
      .select()
      .single();

    if (error) {
      console.error('[Inventory Supabase Error] Upsert failed:', error.message, 'Details:', error.details);
      throw error;
    }
    console.log('[Inventory Debug] Upsert successful:', data.id);
    res.json(data);
  } catch (error) {
    console.error('[Inventory Server Error] Failed to update inventory:', error);
    res.status(500).json({ error: 'Failed to update inventory', details: error.message });
  }
});

// --- ANALYTICS & FORECASTING ROUTES ---

// GET: Forecast (30-day horizon)
router.get('/analytics/forecast', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  const horizonDays = parseInt(req.query.days || '30', 10);
  const lookbackDays = 30;
  const now = new Date();
  const startLookback = new Date(now);
  startLookback.setDate(now.getDate() - lookbackDays);

  try {
    const { data: orders, error: ordersError } = await supabase
      .from('bakery_orders')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .gte('created_at', startLookback.toISOString());

    if (ordersError) throw ordersError;

    const { data: recipes, error: recipesError } = await supabase
      .from('bakery_recipes')
      .select('id, name, price')
      .eq('tenant_id', req.tenantId);

    if (recipesError) throw recipesError;

    const recipeTotals = {};
    const dayBucket = {};

    orders.forEach(order => {
      const datePart = order.created_at ? order.created_at.split('T')[0] : null;
      if (!datePart) return;
      const totalUnits = sumQuantities(order.items || []);
      dayBucket[datePart] = dayBucket[datePart] || { units: 0, revenue: 0 };
      dayBucket[datePart].units += totalUnits;
      dayBucket[datePart].revenue += order.total_price || 0;

      (order.items || []).forEach(item => {
        const key = item.recipeId || item.name;
        if (!recipeTotals[key]) {
          recipeTotals[key] = { name: item.name, recipeId: item.recipeId || null, units: 0, revenue: 0 };
        }
        recipeTotals[key].units += item.quantity || 0;
        recipeTotals[key].revenue += allocateItemRevenue(order, item, totalUnits);
      });
    });

    const dates = Object.keys(dayBucket).sort();
    const last7 = dates.slice(-7);
    const prev7 = dates.slice(-14, -7);

    const avgUnits = (arr) => {
      if (arr.length === 0) return 0;
      return arr.reduce((sum, d) => sum + (dayBucket[d]?.units || 0), 0) / arr.length;
    };

    const last7Avg = avgUnits(last7);
    const prev7Avg = avgUnits(prev7);
    const trendFactor = prev7Avg > 0 ? clamp(last7Avg / prev7Avg, 0.5, 1.5) : 1;

    const coverage = clamp(dates.length / lookbackDays, 0, 1);
    const confidenceScore = Math.round((0.4 + coverage * 0.5) * 100);

    const topRecipes = Object.values(recipeTotals)
      .sort((a, b) => b.units - a.units)
      .slice(0, 10);

    const forecastItems = [];
    const horizonDates = [];
    for (let i = 0; i < horizonDays; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      horizonDates.push(toDateString(d));
    }

    topRecipes.forEach(recipe => {
      const avgDailyUnits = dates.length > 0 ? recipe.units / dates.length : 0;
      const recipePrice = recipes.find(r => r.id === recipe.recipeId)?.price || 0;

      horizonDates.forEach(dateStr => {
        const units = Math.max(0, Math.round(avgDailyUnits * trendFactor));
        forecastItems.push({
          forecast_date: dateStr,
          recipe_id: recipe.recipeId,
          recipe_name: recipe.name,
          forecast_units: units,
          forecast_revenue: units * recipePrice,
          order_source: 'ALL',
          confidence_score: confidenceScore
        });
      });
    });

    const forecastStart = horizonDates[0];
    const forecastEnd = horizonDates[horizonDates.length - 1];

    const { data: forecastRecord, error: forecastError } = await supabase
      .from('bakery_forecasts')
      .insert({
        tenant_id: req.tenantId,
        start_date: forecastStart,
        end_date: forecastEnd,
        horizon_days: horizonDays,
        method: 'SIMPLE_TREND',
        confidence_level: confidenceScore >= 75 ? 'HIGH' : confidenceScore >= 55 ? 'MEDIUM' : 'LOW'
      })
      .select()
      .single();

    if (forecastError) throw forecastError;

    if (forecastItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('bakery_forecast_items')
        .insert(forecastItems.map(item => ({
          ...item,
          tenant_id: req.tenantId,
          forecast_id: forecastRecord.id
        })));

      if (itemsError) throw itemsError;
    }

    res.json({
      forecast: forecastRecord,
      items: forecastItems,
      trendFactor,
      confidenceScore
    });
  } catch (error) {
    console.error('Failed to generate forecast:', error);
    res.status(500).json({ error: 'Failed to generate forecast', details: error.message });
  }
});

// GET: Top Sellers (last 30 days)
router.get('/analytics/top-sellers', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  const lookbackDays = parseInt(req.query.days || '30', 10);
  const limit = parseInt(req.query.limit || '10', 10);
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(now.getDate() - lookbackDays);

  try {
    const { data: orders, error: ordersError } = await supabase
      .from('bakery_orders')
      .select('*')
      .eq('tenant_id', req.tenantId)
      .gte('created_at', startDate.toISOString());

    if (ordersError) throw ordersError;

    const productMap = {};

    orders.forEach(order => {
      const totalUnits = sumQuantities(order.items || []);
      (order.items || []).forEach(item => {
        const key = item.recipeId || item.name;
        if (!productMap[key]) {
          productMap[key] = { recipeId: item.recipeId || null, recipeName: item.name, units: 0, revenue: 0 };
        }
        productMap[key].units += item.quantity || 0;
        productMap[key].revenue += allocateItemRevenue(order, item, totalUnits);
      });
    });

    const ranked = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, limit)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    const startDateStr = toDateString(startDate);
    const endDateStr = toDateString(now);

    const { data: snapshot, error: snapshotError } = await supabase
      .from('bakery_top_sellers')
      .insert({
        tenant_id: req.tenantId,
        start_date: startDateStr,
        end_date: endDateStr
      })
      .select()
      .single();

    if (snapshotError) throw snapshotError;

    if (ranked.length > 0) {
      const { error: itemsError } = await supabase
        .from('bakery_top_seller_items')
        .insert(ranked.map(item => ({
          tenant_id: req.tenantId,
          top_seller_id: snapshot.id,
          recipe_id: item.recipeId,
          recipe_name: item.recipeName,
          units_sold: item.units,
          revenue: item.revenue,
          rank: item.rank
        })));

      if (itemsError) throw itemsError;
    }

    res.json({
      snapshot,
      items: ranked
    });
  } catch (error) {
    console.error('Failed to generate top sellers:', error);
    res.status(500).json({ error: 'Failed to generate top sellers', details: error.message });
  }
});

// GET: Supply Plan (30-day forecast)
router.get('/analytics/supply-plan', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  const horizonDays = parseInt(req.query.days || '30', 10);
  const leadTimeDays = parseInt(req.query.leadTime || '7', 10);
  const safetyBuffer = parseFloat(req.query.buffer || '5000');
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(now.getDate() + horizonDays);

  try {
    const { data: recipes, error: recipesError } = await supabase
      .from('bakery_recipes')
      .select('id, name, ingredients')
      .eq('tenant_id', req.tenantId);

    if (recipesError) throw recipesError;

    const { data: inventory, error: inventoryError } = await supabase
      .from('bakery_inventory')
      .select('*')
      .eq('tenant_id', req.tenantId);

    if (inventoryError) throw inventoryError;

    const forecastResponse = await supabase
      .from('bakery_forecasts')
      .select('id')
      .eq('tenant_id', req.tenantId)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let forecastItems = [];
    if (forecastResponse?.data?.id) {
      const { data: items, error: itemsError } = await supabase
        .from('bakery_forecast_items')
        .select('*')
        .eq('forecast_id', forecastResponse.data.id);

      if (itemsError) throw itemsError;
      forecastItems = items || [];
    }

    const needsMap = {};
    forecastItems.forEach(item => {
      const recipe = recipes.find(r => r.id === item.recipe_id) || recipes.find(r => r.name === item.recipe_name);
      if (!recipe) return;
      (recipe.ingredients || []).forEach(ingredient => {
        const ingName = ingredient.name;
        const weight = ingredient.weight || 0;
        needsMap[ingName] = (needsMap[ingName] || 0) + weight * (item.forecast_units || 0);
      });
    });

    const planItems = Object.entries(needsMap).map(([ingredientName, forecastNeed]) => {
      const inventoryItem = inventory.find(item => item.ingredient_name === ingredientName);
      const currentStock = inventoryItem?.current_stock || 0;
      const needed = forecastNeed || 0;
      const reorderBase = Math.max(0, needed - currentStock);
      const reorderAmount = reorderBase > 0 ? reorderBase + safetyBuffer : 0;

      return {
        ingredient_name: ingredientName,
        current_stock: currentStock,
        forecast_need: needed,
        reorder_amount: reorderAmount,
        unit: inventoryItem?.unit || 'g'
      };
    });

    const { data: planRecord, error: planError } = await supabase
      .from('bakery_supply_plans')
      .insert({
        tenant_id: req.tenantId,
        start_date: toDateString(now),
        end_date: toDateString(endDate),
        lead_time_days: leadTimeDays,
        safety_buffer_grams: safetyBuffer
      })
      .select()
      .single();

    if (planError) throw planError;

    if (planItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('bakery_supply_plan_items')
        .insert(planItems.map(item => ({
          tenant_id: req.tenantId,
          supply_plan_id: planRecord.id,
          ingredient_name: item.ingredient_name,
          current_stock: item.current_stock,
          forecast_need: item.forecast_need,
          reorder_amount: item.reorder_amount,
          unit: item.unit
        })));

      if (itemsError) throw itemsError;
    }

    res.json({
      plan: planRecord,
      items: planItems,
      leadTimeDays,
      safetyBuffer
    });
  } catch (error) {
    console.error('Failed to generate supply plan:', error);
    res.status(500).json({ error: 'Failed to generate supply plan', details: error.message });
  }
});

// GET: Retrieve a specific order by public order_id
router.get('/:orderId', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    console.log('[Supabase Debug] Fetching order:', req.params.orderId, 'for tenant:', req.tenantId);
    let query = supabase
      .from('bakery_orders')
      .select('*')
      .eq('order_id', req.params.orderId);

    if (req.tenantId) {
      query = query.eq('tenant_id', req.tenantId);
    }

    const { data, error } = await query.single();

    if (error) {
      console.error('[Supabase Error] Fetch Order Failed:', error.message, 'Order ID:', req.params.orderId, 'Tenant ID:', req.tenantId);
      return res.status(404).json({ error: 'Order not found', message: error.message });
    }

    // Map Supabase snake_case to Frontend camelCase
    const formattedOrder = {
      id: data.order_id,
      customerName: data.customer_name,
      customerPhone: data.customer_phone,
      customerEmail: data.customer_email,
      notificationPreference: data.notification_preference,
      customerId: data.customer_id,
      totalPrice: data.total_price,
      type: data.fulfillment_type,
      items: data.items,
      notes: data.notes,
      pickupDate: data.pickup_date || null,
      orderSource: data.order_source || 'ONLINE',
      status: data.status,
      promoCode: data.promo_code,
      discountApplied: data.discount_applied,
      paymentMethod: data.payment_method || null,
      createdAt: data.created_at
    };
    res.json(formattedOrder);
  } catch (error) {
    res.status(404).json({ error: 'Order not found' });
  }
});

// GET: Retrieve all orders (for the Baker)
router.get('/', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    const query = supabase.from('bakery_orders').select('*');
    if (req.tenantId) {
      query.eq('tenant_id', req.tenantId);
    } else {
      console.warn('[Supabase Warning] Fetching orders without tenant_id. Headers:', req.headers['x-tenant-slug']);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase Error] Fetch Orders Failed:', error.message);
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        return res.status(500).json({
          error: 'Database schema mismatch: missing tenant_id column in bakery_orders. Please run the latest supabase_schema.sql.'
        });
      }
      throw error;
    }

    const formattedOrders = data.map(order => ({
      id: order.order_id,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      customerEmail: order.customer_email,
      notificationPreference: order.notification_preference,
      customerId: order.customer_id,
      totalPrice: order.total_price,
      type: order.fulfillment_type,
      items: order.items,
      notes: order.notes,
      pickupDate: order.pickup_date || null,
      orderSource: order.order_source || 'ONLINE',
      status: order.status,
      promoCode: order.promo_code,
      discountApplied: order.discount_applied,
      paymentMethod: order.payment_method || null,
      createdAt: order.created_at
    }));

    res.json(formattedOrders);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// --- REVIEWS ROUTES ---

// GET: Reviews for a specific recipe
router.get('/recipes/:recipeId/reviews', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    const { recipeId } = req.params;
    console.log('[Supabase Debug] Fetching reviews for recipe:', recipeId, 'for tenant:', req.tenantId);

    // Validate UUID format to prevent Supabase errors if it's a legacy ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipeId);

    if (!isUuid) {
      console.warn('[Supabase Warning] Invalid UUID for recipe reviews:', recipeId);
      return res.json([]); // Return empty reviews for non-UUID (local) recipes
    }

    const query = supabase.from('bakery_reviews').select('*').eq('recipe_id', recipeId);
    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { data, error } = await query;

    if (error) {
      console.error('[Supabase Error Detail] Query failed:', error);
      throw error;
    }

    if (!data) {
      console.warn('[Supabase Warning] No data returned from reviews query');
      return res.json([]);
    }

    // Map database snake_case to frontend camelCase
    const formattedReviews = data.map(review => ({
      id: review.id,
      recipeId: review.recipe_id,
      customerId: review.customer_id,
      customerName: review.customer_name,
      rating: review.rating,
      comment: review.comment,
      reply: review.reply,
      date: review.created_at || new Date().toISOString()
    }));

    res.json(formattedReviews);
  } catch (error) {
    console.error('[Supabase Error] Fetch Reviews Failed:', error.message, error);
    res.status(500).json({
      error: 'Failed to fetch reviews',
      details: error.message
    });
  }
});

// POST: Add a new review
router.post('/reviews', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const review = req.body;
  try {
    const { data, error } = await supabase
      .from('bakery_reviews')
      .insert([
        {
          tenant_id: req.tenantId,
          recipe_id: review.recipeId,
          customer_id: review.customerId,
          customer_name: review.customer_name,
          rating: review.rating,
          comment: review.comment
        }
      ])
      .select();

    if (error) throw error;

    const formattedReview = {
      id: data && data[0] ? data[0].id : null,
      recipeId: data && data[0] ? data[0].recipe_id : review.recipeId,
      customerId: data && data[0] ? data[0].customer_id : review.customerId,
      customerName: data && data[0] ? data[0].customer_name : review.customerName,
      rating: data && data[0] ? data[0].rating : review.rating,
      comment: data && data[0] ? data[0].comment : review.comment,
      reply: data && data[0] ? data[0].reply : null,
      date: data && data[0] ? data[0].created_at : new Date().toISOString()
    };

    res.status(201).json(formattedReview);
  } catch (error) {
    console.error('[Supabase Error] Save Review Failed:', error.message);
    res.status(500).json({ error: 'Failed to save review' });
  }
});

// DELETE: Remove a review
router.delete('/reviews/:id', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('bakery_reviews')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// PATCH: Update a review (comment/rating)
router.patch('/reviews/:id', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { id } = req.params;
  const { rating, comment } = req.body;
  try {
    const { data, error } = await supabase
      .from('bakery_reviews')
      .update({ rating, comment })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// PATCH: Reply to a review
router.patch('/reviews/:id/reply', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { id } = req.params;
  const { reply } = req.body;
  try {
    const { data, error } = await supabase
      .from('bakery_reviews')
      .update({ reply })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reply to review' });
  }
});

// GET: Subscriptions for a user
router.get('/subscriptions/:customerId', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    const query = supabase.from('bakery_subscriptions').select('*').eq('customer_id', req.params.customerId);
    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { data, error } = await query;

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// POST: Create a new subscription
router.post('/subscriptions', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const sub = req.body;
  try {
    const { data, error } = await supabase
      .from('bakery_subscriptions')
      .insert([
        {
          tenant_id: req.tenantId,
          customer_id: sub.customerId,
          recipe_id: sub.recipeId,
          recipe_name: sub.recipeName,
          quantity: sub.quantity,
          frequency: sub.frequency,
          price: sub.price,
          start_date: sub.startDate,
          next_bake_date: sub.nextBakeDate,
          status: sub.status
        }
      ])
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// PATCH: Update subscription status
router.patch('/subscriptions/:subId/status', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { status } = req.body;
  try {
    const query = supabase
      .from('bakery_subscriptions')
      .update({ status })
      .eq('id', req.params.subId);

    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { data, error } = await query.select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update subscription status' });
  }
});

// PATCH: Update order notes
router.patch('/:orderId/notes', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { notes } = req.body;
  try {
    const query = supabase
      .from('bakery_orders')
      .update({ notes })
      .eq('order_id', req.params.orderId);

    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { data, error } = await query.select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order notes' });
  }
});

// PATCH: Update order status
router.patch('/:orderId/status', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { status } = req.body;
  try {
    const query = supabase
      .from('bakery_orders')
      .update({ status })
      .eq('order_id', req.params.orderId);

    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { data, error } = await query.select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

// --- PROMO CODES ROUTES ---

// GET: All promo codes
router.get('/promos/all', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    const query = supabase.from('bakery_promos').select('*');
    if (req.tenantId) {
      query.eq('tenant_id', req.tenantId);
    } else {
      console.warn('[Supabase Warning] Promos requested but tenantId is missing from request.');
      return res.status(400).json({ error: 'Tenant not identified' });
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase Error] Fetch Promos Failed:', error.message);
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        return res.status(500).json({
          error: 'Database schema mismatch: missing tenant_id column in bakery_promos. Please run the latest supabase_schema.sql.'
        });
      }
      throw error;
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch promo codes' });
  }
});

// POST: Create or update promo code
router.post('/promos', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const promo = req.body;
  try {
    const { data, error } = await supabase
      .from('bakery_promos')
      .upsert({
        id: promo.id,
        tenant_id: req.tenantId,
        code: promo.code.toUpperCase(),
        type: promo.type,
        value: promo.value,
        description: promo.description,
        is_active: promo.isActive ?? true
      })
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save promo code' });
  }
});

// DELETE: Remove a promo code
router.delete('/promos/:id', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    const query = supabase
      .from('bakery_promos')
      .delete()
      .eq('id', req.params.id);

    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { error } = await query;

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete promo code' });
  }
});

// POST: Generate and Email PO
router.post('/generate-po', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  if (!req.tenantId) {
    return res.status(400).json({ error: 'Tenant not identified' });
  }

  const { poItems, supplierEmail } = req.body;

  try {
    // 1. Get Tenant Info for Branding
    const { data: tenant } = await supabase
      .from('bakery_tenants')
      .select('*')
      .eq('id', req.tenantId)
      .single();

    const recipient = supplierEmail || tenant.email || process.env.DEFAULT_CONTACT_EMAIL;

    // 2. Send Email using central utility
    const { sendEmail } = require('../utils/email.cjs');
    const itemsHtml = poItems.map(item => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.amountNeeded}g</td>
      </tr>
    `).join('');

    const result = await sendEmail({
      to: recipient,
      subject: `Purchase Order: ${tenant.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #7D8F69;">Purchase Order</h2>
          <p><strong>From:</strong> ${tenant.name}</p>
          <p><strong>Address:</strong> ${tenant.address || 'Not provided'}</p>
          <hr>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f9f9f9;">
                <th style="text-align: left; padding: 8px;">Ingredient</th>
                <th style="text-align: left; padding: 8px;">Amount Needed</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">This PO was generated automatically by The Daily Dough Production Engine.</p>
        </div>
      `
    });

    if (!result.success) {
      console.warn('[PO Warning] PO email failed to send:', result.error);
      return res.status(200).json({
        success: false,
        message: 'PO generated but email failed to send. Check your SMTP settings.',
        error: result.error
      });
    }

    res.json({ success: true, message: `PO sent to ${recipient}` });

  } catch (error) {
    console.error('[PO Error]', error);
    res.status(500).json({ error: 'Failed to generate or send PO' });
  }
});

module.exports = router;
