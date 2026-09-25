#!/usr/bin/env node
/**
 * One-off migration: seeds the pantry (`bakery_ingredient_costs`) from every
 * distinct ingredient name already sitting inside `bakery_recipes.ingredients`,
 * so a baker's pantry isn't empty on day one just because the pantry table
 * itself is new -- her prices and nutrition were already sitting in her
 * recipes, this just makes them reusable across recipes going forward.
 *
 * For each (tenant, normalized name) not already a pantry row, seeds one
 * from the most recently created recipe that names it, carrying over
 * bulkPrice/bulkWeight/costPerUnit/nutrition/type when that recipe has them.
 * Never overwrites an existing pantry row (including an archived one).
 *
 * Usage: node server/scripts/backfill-pantry.cjs [--dry-run]
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { normalizeName } = require('../utils/pantry.cjs');

const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log(`[Pantry Backfill] Fetching recipes${dryRun ? ' (dry run)' : ''}...`);
  const { data: recipes, error: recipesError } = await supabase
    .from('bakery_recipes')
    .select('id, name, tenant_id, ingredients, created_at')
    .order('created_at', { ascending: false }); // most recent first, so it wins when a name repeats

  if (recipesError) {
    console.error('[Pantry Backfill] Failed to fetch recipes:', recipesError.message);
    process.exit(1);
  }

  const { data: existingRows, error: pantryError } = await supabase
    .from('bakery_ingredient_costs')
    .select('tenant_id, normalized_name, name');

  if (pantryError) {
    console.error('[Pantry Backfill] Failed to fetch existing pantry rows:', pantryError.message);
    process.exit(1);
  }

  // Existing rows (any -- including archived) block a re-seed, so this
  // script is safe to re-run without duplicating or resurrecting anything.
  const existingKeys = new Set(
    (existingRows || []).map((row) => `${row.tenant_id}|${row.normalized_name || normalizeName(row.name)}`)
  );

  const staged = new Map(); // `${tenantId}|${normalizedName}` -> row to insert

  for (const recipe of recipes || []) {
    if (!recipe.tenant_id) continue;
    for (const ing of recipe.ingredients || []) {
      const name = (ing.name || '').trim();
      if (!name) continue;

      const normalized = normalizeName(name);
      const key = `${recipe.tenant_id}|${normalized}`;
      if (existingKeys.has(key) || staged.has(key)) continue; // first (most recent) occurrence wins

      staged.set(key, {
        tenant_id: recipe.tenant_id,
        name,
        display_name: name,
        normalized_name: normalized,
        bulk_price: ing.bulkPrice ?? null,
        bulk_weight: ing.bulkWeight ?? null,
        cost_per_unit: ing.costPerUnit ?? null,
        default_type: ing.type || null,
        nutrition: ing.nutrition || null,
        nutrition_source: ing.nutrition ? 'LOCAL' : null,
        pack_size: ing.bulkWeight ?? null,
        pack_unit: 'g',
        default_use_unit: 'g',
        updated_at: new Date().toISOString()
      });
    }
  }

  console.log(`[Pantry Backfill] ${staged.size} new pantry row(s) to seed across all tenants.`);

  if (staged.size === 0) {
    console.log('[Pantry Backfill] Nothing to do.');
    return;
  }

  if (dryRun) {
    for (const row of staged.values()) {
      console.log(`[Pantry Backfill] (dry run) Would insert "${row.name}" for tenant ${row.tenant_id}` +
        (row.bulk_price ? ` at $${row.bulk_price}/${row.bulk_weight}g` : ' (no price yet)'));
    }
    console.log(`[Pantry Backfill] (dry run) Done. Would insert ${staged.size} row(s).`);
    return;
  }

  const rows = [...staged.values()];
  const BATCH_SIZE = 200;
  let insertedCount = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error: insertError } = await supabase.from('bakery_ingredient_costs').insert(batch);
    if (insertError) {
      console.error(`[Pantry Backfill] Failed to insert batch starting at ${i}:`, insertError.message);
      continue;
    }
    insertedCount += batch.length;
    console.log(`[Pantry Backfill] Inserted ${insertedCount}/${rows.length}...`);
  }

  console.log(`\n[Pantry Backfill] Done. Inserted ${insertedCount} pantry row(s).`);
}

main();
