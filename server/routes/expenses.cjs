const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const { requireBaker } = require('../utils/auth.cjs');

// Every route here is the baker's own books. The bakery is always the signed-in
// baker's (from their login), whatever x-tenant-id the browser sends.
router.use(requireBaker(supabase), (req, _res, next) => {
  req.headers['x-tenant-id'] = req.bakerTenantId;
  next();
});

/** Copies only the named fields that were sent. */
const pick = (body, fields) => {
  const out = {};
  for (const f of fields) if (body && body[f] !== undefined) out[f] = body[f];
  return out;
};

const EXPENSE_FIELDS = ['amount', 'category', 'date', 'description', 'is_deductible', 'payment_method', 'receipt_url'];

/**
 * POST /api/expenses
 * Add a new expense
 */
router.post('/', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const expense = {
      ...pick(req.body, EXPENSE_FIELDS),
      tenant_id: tenantId,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('bakery_expenses')
      .insert(expense)
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ error: 'Failed to create expense' });
  }
});

/**
 * GET /api/expenses
 * Get all expenses for tenant, optionally filtered by date range
 */
router.get('/', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const { start, end } = req.query;

    let query = supabase
      .from('bakery_expenses')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('date', { ascending: false });

    if (start) {
      query = query.gte('date', start);
    }
    if (end) {
      query = query.lte('date', end);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

/**
 * PATCH /api/expenses/:id
 * Update an expense
 */
router.patch('/:id', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const { data, error } = await supabase
      .from('bakery_expenses')
      .update(pick(req.body, EXPENSE_FIELDS))
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

/**
 * DELETE /api/expenses/:id
 * Delete an expense
 */
router.delete('/:id', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { id } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const { error } = await supabase
      .from('bakery_expenses')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

    if (error) throw error;

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
});

/**
 * GET /api/expenses/summary
 * Get expense summary by category
 */
router.get('/summary', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const { start, end } = req.query;

    let query = supabase
      .from('bakery_expenses')
      .select('category, amount')
      .eq('tenant_id', tenantId);

    if (start) query = query.gte('date', start);
    if (end) query = query.lte('date', end);

    const { data, error } = await query;

    if (error) throw error;

    // Group by category
    const summary = {};
    let total = 0;

    data.forEach(expense => {
      if (!summary[expense.category]) {
        summary[expense.category] = 0;
      }
      summary[expense.category] += expense.amount;
      total += expense.amount;
    });

    res.json({
      total,
      by_category: Object.entries(summary).map(([category, amount]) => ({
        category,
        amount
      }))
    });
  } catch (error) {
    console.error('Error fetching expense summary:', error);
    res.status(500).json({ error: 'Failed to fetch expense summary' });
  }
});

module.exports = router;
