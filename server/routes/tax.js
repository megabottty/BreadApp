const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

/**
 * GET /api/tax/settings
 * Get tax settings for the current tenant
 */
router.get('/settings', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const tenantSlug = req.headers['x-tenant-slug'];

    if (!tenantId && !tenantSlug) {
      return res.status(400).json({ error: 'Tenant ID or slug required' });
    }

    let query = supabase
      .from('bakery_tax_settings')
      .select('*');

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    } else {
      // Lookup tenant ID from slug
      const { data: tenant } = await supabase
        .from('bakery_tenants')
        .select('id')
        .eq('slug', tenantSlug)
        .single();

      if (!tenant) {
        return res.status(404).json({ error: 'Tenant not found' });
      }
      query = query.eq('tenant_id', tenant.id);
    }

    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No settings found, return default
        return res.status(404).json({ error: 'No tax settings found' });
      }
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Error fetching tax settings:', error);
    res.status(500).json({ error: 'Failed to fetch tax settings' });
  }
});

/**
 * PATCH /api/tax/settings
 * Update or create tax settings
 */
router.patch('/settings', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const settings = {
      tenant_id: tenantId,
      ...req.body,
      updated_at: new Date().toISOString()
    };

    // Upsert (insert or update)
    const { data, error } = await supabase
      .from('bakery_tax_settings')
      .upsert(settings, { onConflict: 'tenant_id' })
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('Error updating tax settings:', error);
    res.status(500).json({ error: 'Failed to update tax settings' });
  }
});

/**
 * GET /api/tax/report
 * Generate tax report for a date range
 */
router.get('/report', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { start, end } = req.query;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    if (!start || !end) {
      return res.status(400).json({ error: 'Start and end dates required' });
    }

    // Get all completed orders in date range
    const { data: orders, error: ordersError } = await supabase
      .from('bakery_orders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'COMPLETED')
      .gte('created_at', start)
      .lte('created_at', end);

    if (ordersError) throw ordersError;

    // Calculate tax totals
    let totalSales = 0;
    let taxableSales = 0;
    let taxExemptSales = 0;
    let totalTaxCollected = 0;

    orders.forEach(order => {
      const subtotal = order.subtotal || order.totalPrice || 0;
      const tax = order.taxAmount || 0;

      totalSales += subtotal;
      if (tax > 0) {
        taxableSales += subtotal;
        totalTaxCollected += tax;
      } else {
        taxExemptSales += subtotal;
      }
    });

    const report = {
      period_start: start,
      period_end: end,
      total_sales: totalSales,
      taxable_sales: taxableSales,
      tax_exempt_sales: taxExemptSales,
      total_tax_collected: totalTaxCollected,
      order_count: orders.length
    };

    res.json(report);
  } catch (error) {
    console.error('Error generating tax report:', error);
    res.status(500).json({ error: 'Failed to generate tax report' });
  }
});

/**
 * GET /api/tax/deductions/:year
 * Get tax deduction summary for a year
 */
router.get('/deductions/:year', async (req, res) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    const { year } = req.params;

    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID required' });
    }

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // Get all deductible expenses for the year
    const { data: expenses, error } = await supabase
      .from('bakery_expenses')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_deductible', true)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) throw error;

    // Calculate totals and breakdown by category
    let totalDeductible = 0;
    const breakdown = {};

    expenses.forEach(expense => {
      totalDeductible += expense.amount;
      if (!breakdown[expense.category]) {
        breakdown[expense.category] = 0;
      }
      breakdown[expense.category] += expense.amount;
    });

    const breakdownArray = Object.entries(breakdown).map(([category, amount]) => ({
      category,
      amount
    }));

    // Estimate tax savings (assuming 25% effective tax rate)
    const estimatedTaxSavings = totalDeductible * 0.25;

    res.json({
      total_deductible_expenses: totalDeductible,
      breakdown_by_category: breakdownArray,
      estimated_tax_savings: estimatedTaxSavings
    });
  } catch (error) {
    console.error('Error fetching tax deductions:', error);
    res.status(500).json({ error: 'Failed to fetch tax deductions' });
  }
});

module.exports = router;
