#!/usr/bin/env node
/**
 * One-off: copies an existing bagel recipe into new flavor products and
 * gives every one of them (the original included) the same 4 Pack / 8 Pack
 * pricing via `pack_options`.
 *
 * Each copy keeps the source's ingredients, images, category, times, add-ons
 * and weights; it gets its own name and description and no sku/barcode.
 * `price` is set to the 4 Pack price so the base price matches the cheapest
 * pack. Flavors whose name already exists for the tenant are skipped, so the
 * script is safe to re-run.
 *
 * Usage: node server/scripts/clone-bagel-flavors.cjs [--dry-run]
 */
require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ---- Config ---------------------------------------------------------------
const SOURCE_NAME = 'Everything Flavored Bagels';
const PRICES = { four: 14, eight: 20 };
/** [{ name, description? }] -- description falls back to the source's. */
const FLAVORS = [
  { name: 'Poppy Seed Bagels' },
  { name: 'Cinnamon Raisin Bagels' },
  { name: 'Plain Bagels' },
  { name: 'Pumpernickel Bagels' }
];
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function buildPackOptions() {
  return [
    { id: crypto.randomUUID(), label: '4 Pack', size: 4, price: PRICES.four },
    { id: crypto.randomUUID(), label: '8 Pack', size: 8, price: PRICES.eight }
  ];
}

async function main() {
  const missingPrice = Object.entries(PRICES).find(([, v]) => typeof v !== 'number' || !(v > 0));
  if (missingPrice) {
    console.error(`[Bagel Flavors] Set a positive price for "${missingPrice[0]}" in PRICES first.`);
    process.exit(1);
  }

  const { data: sources, error: sourceError } = await supabase
    .from('bakery_recipes')
    .select('*')
    .eq('name', SOURCE_NAME);
  if (sourceError) throw new Error(sourceError.message);
  if (!sources || sources.length !== 1) {
    throw new Error(`Expected exactly one recipe named "${SOURCE_NAME}", found ${sources ? sources.length : 0}.`);
  }
  const source = sources[0];

  const { data: existing, error: existingError } = await supabase
    .from('bakery_recipes')
    .select('name')
    .eq('tenant_id', source.tenant_id);
  if (existingError) throw new Error(existingError.message);
  const existingNames = new Set(existing.map(r => r.name.trim().toLowerCase()));

  console.log(`[Bagel Flavors] Source: ${source.name} (${source.id})${dryRun ? ' -- DRY RUN' : ''}`);

  // Pack pricing on the original bagel.
  const sourcePacks = buildPackOptions();
  console.log(`  update  ${source.name}: price ${PRICES.four}, packs ${sourcePacks.map(p => `${p.label} $${p.price}`).join(', ')}`);
  if (!dryRun) {
    const { error } = await supabase
      .from('bakery_recipes')
      .update({ pack_options: sourcePacks, price: PRICES.four })
      .eq('id', source.id);
    if (error) throw new Error(`Updating ${source.name}: ${error.message}`);
  }

  for (const flavor of FLAVORS) {
    const name = flavor.name.trim();
    if (existingNames.has(name.toLowerCase())) {
      console.log(`  skip    ${name} (already exists)`);
      continue;
    }
    // eslint-disable-next-line no-unused-vars
    const { id, created_at, sku, barcode, ...rest } = source;
    const row = {
      ...rest,
      name,
      description: flavor.description || source.description,
      price: PRICES.four,
      pack_options: buildPackOptions()
    };
    console.log(`  insert  ${name}`);
    if (!dryRun) {
      const { error } = await supabase.from('bakery_recipes').insert(row);
      if (error) throw new Error(`Inserting ${name}: ${error.message}`);
    }
    existingNames.add(name.toLowerCase());
  }

  console.log('[Bagel Flavors] Done.');
}

main().catch(err => {
  console.error('[Bagel Flavors] Failed:', err.message);
  process.exit(1);
});
