const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// POST: Place a new order
router.post('/', async (req, res) => {
  const orderData = req.body;

  try {
    const { data, error } = await supabase
      .from('bakery_orders')
      .insert([
        {
          order_id: orderData.id,
          customer_name: orderData.customerName,
          customer_phone: orderData.customerPhone,
          total_price: orderData.totalPrice,
          fulfillment_type: orderData.type,
          items: orderData.items,
          notes: orderData.notes,
          status: 'PENDING'
        }
      ])
      .select();

    if (error) throw error;

    res.status(201).json({
      message: 'Order saved to the cloud! ☁️🥖',
      order: data[0]
    });
  } catch (error) {
    console.error('Error saving order:', error);
    res.status(500).json({ error: 'Failed to save order to database' });
  }
});

// GET: Retrieve all orders (for the Baker)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bakery_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// --- NEW RECIPE ROUTES ---

// GET: All recipes
router.get('/recipes', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bakery_recipes')
      .select('*');
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// POST: Save/Update recipe
router.post('/recipes', async (req, res) => {
  const recipe = req.body;
  try {
    const { data, error } = await supabase
      .from('bakery_recipes')
      .upsert({
        id: recipe.id || undefined, // Supabase will generate if missing
        name: recipe.name,
        category: recipe.category,
        price: recipe.price,
        description: recipe.description,
        true_hydration: recipe.trueHydration,
        ingredients: recipe.ingredients,
        images: recipe.images
      })
      .select();
    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error saving recipe:', error);
    res.status(500).json({ error: 'Failed to save recipe' });
  }
});

module.exports = router;
