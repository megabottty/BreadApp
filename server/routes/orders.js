const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('MISSING SUPABASE CONFIG: Check your environment variables!');
}

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Middleware to extract tenant_id from headers
const tenantMiddleware = async (req, res, next) => {
  const tenantSlug = req.headers['x-tenant-slug'];
  if (!tenantSlug) {
    console.warn(`[Tenant Middleware] Missing x-tenant-slug header for ${req.method} ${req.originalUrl}`);
    req.tenantId = null;
    return next();
  }

  try {
    const { data: tenant, error } = await supabase
      .from('bakery_tenants')
      .select('id')
      .eq('slug', tenantSlug)
      .single();

    if (error || !tenant) {
      console.warn(`[Tenant Middleware] Bakery not found for slug: "${tenantSlug}". Ensure the bakery is registered.`);
      return res.status(404).json({ error: 'Bakery not found' });
    }

    req.tenantId = tenant.id;
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
    const { data, error } = await supabase
      .from('bakery_orders')
      .insert([
        {
          tenant_id: req.tenantId,
          order_id: orderData.id,
          customer_name: orderData.customerName,
          customer_phone: orderData.customerPhone,
          customer_id: orderData.customerId,
          total_price: orderData.totalPrice,
          fulfillment_type: orderData.type,
          items: orderData.items,
          notes: orderData.notes,
          pickup_date: orderData.pickupDate,
          status: 'PENDING',
          promo_code: orderData.promoCode,
          discount_applied: orderData.discountApplied
        }
      ])
      .select();

    if (error) {
      console.error('[Supabase Error] Order Insert Failed:', error.message, error.details);
      throw error;
    }
    console.log('[Supabase Debug] Order saved successfully:', data[0].id);

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
    const query = supabase.from('bakery_recipes').select('*');
    if (req.tenantId) {
      query.eq('tenant_id', req.tenantId);
    } else {
      console.warn('[Supabase Warning] Recipes requested but tenantId is missing from request.');
      return res.status(400).json({ error: 'Tenant not identified' });
    }

    const { data, error } = await query;
    if (error) {
      console.error('[Supabase Error] Fetch Recipes Failed:', error.message);
      if (error.message.includes('column') && error.message.includes('does not exist')) {
        return res.status(500).json({
          error: 'Database schema mismatch: missing tenant_id column in bakery_recipes. Please run the latest supabase_schema.sql.'
        });
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
      createdAt: recipe.created_at
    }));

    res.json(formattedRecipes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recipes' });
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

// POST: Register a new bakery
router.post('/register-bakery', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  const { name, slug } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: 'Name and slug are required' });
  }

  try {
    const { data, error } = await supabase
      .from('bakery_tenants')
      .insert([{ name, slug }])
      .select()
      .single();

    if (error) {
      console.error('[Supabase Error] Bakery Registration Failed:', error.message, error.details);

      // Check for missing table error
      if (error.message.includes("Could not find the table 'public.bakery_tenants'")) {
        return res.status(500).json({
          error: 'Database table missing. Please ensure you have run the latest supabase_schema.sql in your Supabase SQL Editor.'
        });
      }

      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ error: 'This bakery slug is already taken' });
      }
      throw error;
    }

    res.status(201).json(data);
  } catch (error) {
    console.error('Error registering bakery:', error);
    res.status(500).json({ error: 'Failed to register bakery' });
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
        images: recipe.images
      })
      .select();

    if (error) {
      console.error('[Supabase Error] Recipe Upsert Failed:', error.message, error.details);
      throw error;
    }
    console.log('[Supabase Debug] Recipe saved successfully:', data[0].id);
    res.json(data[0]);
  } catch (error) {
    console.error('Error saving recipe:', error);
    res.status(500).json({ error: 'Failed to save recipe' });
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

// GET: Retrieve a specific order by public order_id
router.get('/:orderId', async (req, res) => {
  if (!supabase) {
    return res.status(500).json({ error: 'Database connection not configured' });
  }
  try {
    console.log('[Supabase Debug] Fetching order:', req.params.orderId, 'for tenant:', req.tenantId);
    const query = supabase
      .from('bakery_orders')
      .select('*')
      .eq('order_id', req.params.orderId);

    if (req.tenantId) query.eq('tenant_id', req.tenantId);

    const { data, error } = await query.single();

    if (error) {
      console.error('[Supabase Error] Fetch Order Failed:', error.message);
      throw error;
    }

    // Map Supabase snake_case to Frontend camelCase
    const formattedOrder = {
      id: data.order_id,
      customerName: data.customer_name,
      customerPhone: data.customer_phone,
      customerId: data.customer_id,
      totalPrice: data.total_price,
      type: data.fulfillment_type,
      items: data.items,
      notes: data.notes,
      pickupDate: data.pickup_date || null,
      status: data.status,
      promoCode: data.promo_code,
      discountApplied: data.discount_applied,
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
      customerId: order.customer_id,
      totalPrice: order.total_price,
      type: order.fulfillment_type,
      items: order.items,
      notes: order.notes,
      pickupDate: order.pickup_date || null,
      status: order.status,
      promoCode: order.promo_code,
      discountApplied: order.discount_applied,
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
          customer_name: review.customerName,
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
      date: data && data[0] ? data[0].created_at : new Date().toISOString()
    };

    res.status(201).json(formattedReview);
  } catch (error) {
    console.error('[Supabase Error] Save Review Failed:', error.message);
    res.status(500).json({ error: 'Failed to save review' });
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

module.exports = router;
