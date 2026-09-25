/**
 * Shared USDA FoodData Central helper.
 *
 * Used by the ingredient search proxy route (so the browser never talks to
 * USDA directly — avoids CSP/CORS failures and keeps the API key server-side)
 * and by the one-off nutrition backfill script.
 */

const USDA_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// Simple in-memory cache: the DEMO_KEY allows only ~30 req/hour per IP, and
// with all users behind one server IP, repeat searches must not hit USDA.
const cache = new Map();

function getApiKey() {
  return process.env.USDA_API_KEY || 'DEMO_KEY';
}

// USDA nutrient IDs: 1008 Energy (kcal), 1003 Protein, 1005 Carbohydrate, 1004 Total fat
function mapFoodToNutrition(food) {
  const getNutrient = (id) => {
    const n = (food.foodNutrients || []).find((nut) => nut.nutrientId === id);
    return n ? n.value : 0;
  };
  return {
    caloriesPer100g: getNutrient(1008),
    proteinPer100g: getNutrient(1003),
    carbsPer100g: getNutrient(1005),
    fatPer100g: getNutrient(1004)
  };
}

// Prefer reference datasets over branded products for a generic ingredient name.
function pickBestMatch(foods) {
  if (!Array.isArray(foods) || foods.length === 0) return null;
  return foods.find((f) => f.dataType === 'Foundation' || f.dataType === 'SR Legacy') || foods[0];
}

function readCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), value });
}

/**
 * Search USDA for foods matching `query`.
 * Resolves to [{ name, dataType, nutrition }]. Throws an Error with `.status`
 * set to the upstream HTTP status on failure (429 = rate limited).
 */
async function searchFoods(query, { pageSize = 10 } = {}) {
  const normalized = String(query || '').trim().toLowerCase();
  const size = Math.min(25, Math.max(1, Number(pageSize) || 10));
  // v2: results now carry brandName/packageWeight/fdcId. Bumped so a
  // still-warm cache entry from before this field doesn't serve field-less
  // results after deploy.
  const cacheKey = `v2|${normalized}|${size}`;

  const cached = readCache(cacheKey);
  if (cached) return cached;

  const url = `${USDA_SEARCH_URL}?query=${encodeURIComponent(normalized)}&pageSize=${size}&api_key=${getApiKey()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`USDA API returned ${res.status} for "${normalized}"`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const results = (data.foods || []).map((food) => ({
    name: food.description,
    dataType: food.dataType,
    nutrition: mapFoodToNutrition(food),
    // Branded foods carry brand + package info; Foundation/SR Legacy foods
    // (generic ingredients) won't have these. Passed through so a Branded
    // hit can pre-fill the recipe row's package price/weight fields --
    // "add an item, its weight" from a single pick, instead of two lookups.
    brandName: food.brandName || food.brandOwner || undefined,
    packageWeight: food.packageWeight || undefined,
    fdcId: food.fdcId != null ? String(food.fdcId) : undefined
  }));

  writeCache(cacheKey, results);
  return results;
}

module.exports = { searchFoods, mapFoodToNutrition, pickBestMatch };
