#!/usr/bin/env node
/**
 * One-off migration: finds ingredients across all bakery_recipes that have no
 * `nutrition` data attached (and aren't in the app's local MOCK_INGREDIENTS_DB),
 * looks up real values via the USDA FoodData Central API (same source the
 * recipe editor's ingredient search already uses), and backfills them.
 *
 * Ingredients with no nutrition data silently count as 0 calories/protein/
 * carbs/fat in nutrition-facts calculations, which is why some recipes that
 * differ only by such an ingredient (e.g. "Rolled in Oats" vs "Plain
 * Sourdough") showed identical nutrition facts.
 *
 * Usage: node server/scripts/backfill-nutrition.cjs [--dry-run]
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const usdaApiKey = process.env.USDA_API_KEY || 'DEMO_KEY';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in environment.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Mirrors src/app/logic/bakers-math.ts MOCK_INGREDIENTS_DB and the extended
// list in src/app/services/ingredient.service.ts, so we don't re-fetch names
// the app already resolves locally. Lookup is case-insensitive.
const KNOWN_LOCAL_NAMES = new Set([
  'bread flour', 'water', 'starter', 'salt', 'whole wheat flour', 'honey',
  'cheddar cheese', 'parmesan', 'olive oil', 'walnuts', 'rye flour', 'butter',
  'sugar', 'brown sugar', 'egg', 'milk', 'cinnamon', 'chocolate chips', 'yeast',
  'milk chocolate', 'dark chocolate', 'almonds', 'blueberries', 'strawberries',
  'raisins', 'oats', 'pumpkin seeds', 'sunflower seeds', 'cream cheese',
  'yogurt', 'coconut oil', 'maple syrup', 'molasses', 'sea salt',
  'vanilla extract', 'baking powder', 'baking soda'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Curated, verified per-100g nutrition values for ingredients discovered in
// the current recipe catalog that either have no reliable USDA API match
// (ambiguous/misspelled names like "Gauva paste", "GARLIC") or where the
// API's top search result was a poor match (e.g. "pumpkin puree" matching
// "Bread, pumpkin" instead of plain pumpkin). Keyed lowercase/trimmed.
// Sourced from standard USDA FoodData Central reference entries.
const CURATED_OVERRIDES = {
  'blueberry': { caloriesPer100g: 57, proteinPer100g: 0.7, carbsPer100g: 14.5, fatPer100g: 0.3 },
  'lemon': { caloriesPer100g: 29, proteinPer100g: 1.1, carbsPer100g: 9.3, fatPer100g: 0.3 },
  'cheese': { caloriesPer100g: 403, proteinPer100g: 25, carbsPer100g: 1.3, fatPer100g: 33 },
  'jalapenos': { caloriesPer100g: 29, proteinPer100g: 0.91, carbsPer100g: 6.5, fatPer100g: 0.37 },
  'cocoa powder': { caloriesPer100g: 228, proteinPer100g: 19.6, carbsPer100g: 57.9, fatPer100g: 13.7 },
  'pumpkin puree': { caloriesPer100g: 34, proteinPer100g: 1.1, carbsPer100g: 8.1, fatPer100g: 0.3 },
  'powdered sugar': { caloriesPer100g: 389, proteinPer100g: 0, carbsPer100g: 99.8, fatPer100g: 0 },
  'heavy whipping cream': { caloriesPer100g: 340, proteinPer100g: 2.1, carbsPer100g: 2.8, fatPer100g: 36 },
  'minced garlic': { caloriesPer100g: 149, proteinPer100g: 6.36, carbsPer100g: 33.1, fatPer100g: 0.5 },
  'rosemary': { caloriesPer100g: 131, proteinPer100g: 3.3, carbsPer100g: 20.7, fatPer100g: 5.9 },
  'garlic': { caloriesPer100g: 149, proteinPer100g: 6.36, carbsPer100g: 33.1, fatPer100g: 0.5 },
  'gauva paste': { caloriesPer100g: 280, proteinPer100g: 0.5, carbsPer100g: 71, fatPer100g: 0.3 },
  'guava paste': { caloriesPer100g: 280, proteinPer100g: 0.5, carbsPer100g: 71, fatPer100g: 0.3 },
  'oatmeal': { caloriesPer100g: 389, proteinPer100g: 16.9, carbsPer100g: 66.3, fatPer100g: 6.9 }
};

async function lookupNutrition(name) {
  const curated = CURATED_OVERRIDES[name.toLowerCase().trim()];
  if (curated) {
    return { matchedName: `${name} (curated reference value)`, nutrition: curated };
  }

  // Fall back to the USDA API for any future/unknown ingredient name, with
  // retry-on-429 since the DEMO_KEY rate limit is easy to hit.
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(name)}&pageSize=5&api_key=${usdaApiKey}`;
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      throw new Error(`USDA API returned ${res.status} for "${name}"`);
    }
    const data = await res.json();
    const foods = data.foods || [];
    if (foods.length === 0) return null;

    const best = foods.find((f) => f.dataType === 'Foundation' || f.dataType === 'SR Legacy') || foods[0];

    const getNutrient = (id) => {
      const n = (best.foodNutrients || []).find((nut) => nut.nutrientId === id);
      return n ? n.value : 0;
    };

    return {
      matchedName: best.description,
      nutrition: {
        caloriesPer100g: getNutrient(1008),
        proteinPer100g: getNutrient(1003),
        carbsPer100g: getNutrient(1005),
        fatPer100g: getNutrient(1004)
      }
    };
  }

  throw new Error(`USDA API rate-limited after retries for "${name}"`);
}

async function main() {
  console.log(`[Nutrition Backfill] Fetching recipes${dryRun ? ' (dry run)' : ''}...`);
  const { data: recipes, error } = await supabase.from('bakery_recipes').select('*');

  if (error) {
    console.error('[Nutrition Backfill] Failed to fetch recipes:', error.message);
    process.exit(1);
  }

  // Collect unique ingredient names (trimmed) missing nutrition data.
  const missingNames = new Set();
  for (const recipe of recipes) {
    for (const ing of recipe.ingredients || []) {
      const name = (ing.name || '').trim();
      if (!name) continue;
      if (ing.nutrition) continue;
      if (KNOWN_LOCAL_NAMES.has(name.toLowerCase())) continue;
      missingNames.add(name);
    }
  }

  console.log(`[Nutrition Backfill] ${missingNames.size} unique ingredient name(s) need lookup:`, [...missingNames]);

  const resolved = new Map(); // name -> nutrition object (or null if unresolvable)
  for (const name of missingNames) {
    try {
      const result = await lookupNutrition(name);
      if (result) {
        console.log(`[Nutrition Backfill] "${name}" -> matched "${result.matchedName}":`, result.nutrition);
        resolved.set(name, result.nutrition);
      } else {
        console.warn(`[Nutrition Backfill] "${name}" -> no USDA match found, leaving as-is.`);
        resolved.set(name, null);
      }
    } catch (e) {
      console.error(`[Nutrition Backfill] Lookup failed for "${name}":`, e.message);
      resolved.set(name, null);
    }
    await sleep(1200); // Be gentle with the DEMO_KEY rate limit.
  }

  let updatedCount = 0;
  for (const recipe of recipes) {
    let changed = false;
    const ingredients = (recipe.ingredients || []).map((ing) => {
      const name = (ing.name || '').trim();
      if (!name || ing.nutrition || KNOWN_LOCAL_NAMES.has(name.toLowerCase())) return ing;
      const nutrition = resolved.get(name);
      if (!nutrition) return ing;
      changed = true;
      return { ...ing, nutrition };
    });

    if (!changed) continue;

    if (dryRun) {
      console.log(`[Nutrition Backfill] (dry run) Would update recipe ${recipe.id} (${recipe.name}).`);
      updatedCount++;
      continue;
    }

    const { error: updateError } = await supabase
      .from('bakery_recipes')
      .update({ ingredients })
      .eq('id', recipe.id);

    if (updateError) {
      console.error(`[Nutrition Backfill] Failed to update recipe ${recipe.id}:`, updateError.message);
      continue;
    }

    console.log(`[Nutrition Backfill] Updated recipe ${recipe.id} (${recipe.name}).`);
    updatedCount++;
  }

  const unresolved = [...resolved.entries()].filter(([, v]) => v === null).map(([k]) => k);
  console.log(`\n[Nutrition Backfill] Done. Recipes updated: ${updatedCount}.`);
  if (unresolved.length > 0) {
    console.log(`[Nutrition Backfill] Could not resolve (still 0-nutrition, needs manual entry): ${unresolved.join(', ')}`);
  }
}

main();
