/**
 * Pantry persistence helpers, shared by the pantry routes in
 * server/routes/orders.cjs. The physical table is `bakery_ingredient_costs`
 * (historical name -- see the COMMENT ON TABLE in supabase_schema.sql); this
 * module is the only place that reads/writes its pantry columns, so the
 * columns and the merge behavior stay consistent across all three routes.
 *
 * `normalizeName` must stay in lockstep with the client's
 * src/app/logic/units.ts `normalizeIngredientName` -- both exist so
 * "Bread Flour" and " bread flour " resolve to the same pantry row.
 */

const PANTRY_TABLE = 'bakery_ingredient_costs';

const ALLOWED_UNITS = new Set(['g', 'kg', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'each']);

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function isValidUnit(unit) {
  return unit === undefined || unit === null || ALLOWED_UNITS.has(unit);
}

/**
 * Mirrors the exact precedence in src/app/logic/bakers-math.ts's
 * `resolveIngredientCostPerGram` -- bulk pack basis wins when bulk_weight is
 * set, else the legacy per-100g fallback, else unknown. Duplicated here
 * (rather than shared) because this is a `.cjs` server module and that one
 * is a `.ts` ES module; the pantry list screen needs a per-gram cost without
 * pulling the frontend bundle into the server.
 */
function resolveCostPerGram({ bulk_price, bulk_weight, cost_per_unit }) {
  const bulkWeightNum = Number(bulk_weight);
  if (bulk_price && bulk_weight && bulkWeightNum > 0) {
    return { costPerGram: Number(bulk_price) / bulkWeightNum, costBasis: 'PACK' };
  }
  const legacy = cost_per_unit === undefined || cost_per_unit === null ? NaN : Number(cost_per_unit);
  if (!Number.isNaN(legacy)) {
    return { costPerGram: legacy / 100, costBasis: legacy > 0 ? 'LEGACY' : 'FREE' };
  }
  return { costPerGram: 0, costBasis: 'MISSING' };
}

/** snake_case DB row -> camelCase PantryItem the frontend expects. */
function formatPantryRow(row) {
  const { costPerGram, costBasis } = resolveCostPerGram(row);
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name || normalizeName(row.name),
    bulkPrice: row.bulk_price,
    bulkWeight: row.bulk_weight,
    costPerUnit: row.cost_per_unit,
    packSize: row.pack_size,
    packUnit: row.pack_unit || 'g',
    defaultUseUnit: row.default_use_unit || 'g',
    gramsPerCup: row.grams_per_cup,
    gramsPerItem: row.grams_per_item,
    defaultType: row.default_type,
    nutrition: row.nutrition,
    nutritionSource: row.nutrition_source,
    usdaFdcId: row.usda_fdc_id,
    isArchived: !!row.is_archived,
    costPerGram,
    costBasis,
    updatedAt: row.updated_at
  };
}

/**
 * camelCase patch from the client -> snake_case DB columns. Only includes
 * keys that were actually provided, so a partial (e.g. price-only) patch
 * from the recipe row's price chip never clobbers columns it didn't mean to
 * touch -- see `savePantryItem`.
 */
function toPantryColumns(patch) {
  const columns = {};
  if (patch.bulkPrice !== undefined) columns.bulk_price = patch.bulkPrice;
  if (patch.bulkWeight !== undefined) columns.bulk_weight = patch.bulkWeight;
  if (patch.costPerUnit !== undefined) columns.cost_per_unit = patch.costPerUnit;
  if (patch.packSize !== undefined) columns.pack_size = patch.packSize;
  if (patch.packUnit !== undefined) columns.pack_unit = patch.packUnit;
  if (patch.defaultUseUnit !== undefined) columns.default_use_unit = patch.defaultUseUnit;
  if (patch.gramsPerCup !== undefined) columns.grams_per_cup = patch.gramsPerCup;
  if (patch.gramsPerItem !== undefined) columns.grams_per_item = patch.gramsPerItem;
  if (patch.defaultType !== undefined) columns.default_type = patch.defaultType;
  if (patch.nutrition !== undefined) columns.nutrition = patch.nutrition;
  if (patch.nutritionSource !== undefined) columns.nutrition_source = patch.nutritionSource;
  if (patch.usdaFdcId !== undefined) columns.usda_fdc_id = patch.usdaFdcId;
  if (patch.isArchived !== undefined) columns.is_archived = patch.isArchived;
  return columns;
}

/**
 * Creates or merges one pantry item by (tenant, normalized name).
 *
 * Deliberately NOT a PostgREST batch upsert: upserting a heterogeneous
 * array unions columns across rows and fills any gaps with null, so a
 * price-only patch (from the recipe row's price chip) would blank that
 * item's nutrition and density the moment it saved. Select-then-write
 * sidesteps this entirely -- please don't "simplify" this back into an
 * upsert; it would silently reintroduce that bug.
 */
async function savePantryItem(supabase, tenantId, patch) {
  const name = String(patch.name || '').trim();
  if (!name) {
    const err = new Error('Ingredient name is required');
    err.status = 400;
    throw err;
  }
  if (!isValidUnit(patch.packUnit) || !isValidUnit(patch.defaultUseUnit)) {
    const err = new Error(`Unit must be one of: ${[...ALLOWED_UNITS].join(', ')}`);
    err.status = 400;
    throw err;
  }

  const normalizedName = normalizeName(name);
  const { data: existing, error: findError } = await supabase
    .from(PANTRY_TABLE)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('normalized_name', normalizedName)
    .maybeSingle();

  if (findError) throw findError;

  const columns = toPantryColumns(patch);
  columns.name = name;
  columns.display_name = name;
  columns.normalized_name = normalizedName;
  columns.updated_at = new Date().toISOString();

  if (existing) {
    const { data, error } = await supabase
      .from(PANTRY_TABLE)
      .update(columns)
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
      .select()
      .single();
    if (error) throw error;
    return formatPantryRow(data);
  }

  const { data, error } = await supabase
    .from(PANTRY_TABLE)
    .insert({ tenant_id: tenantId, ...columns })
    .select()
    .single();
  if (error) throw error;
  return formatPantryRow(data);
}

async function listPantryItems(supabase, tenantId) {
  const { data, error } = await supabase
    .from(PANTRY_TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_archived', false)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(formatPantryRow);
}

/** Soft delete -- a hard delete on a name that recipes still name-match
 * against would silently zero their cost the next time they're opened. */
async function archivePantryItem(supabase, tenantId, id) {
  const { error } = await supabase
    .from(PANTRY_TABLE)
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

module.exports = {
  PANTRY_TABLE,
  ALLOWED_UNITS,
  normalizeName,
  resolveCostPerGram,
  formatPantryRow,
  toPantryColumns,
  savePantryItem,
  listPantryItems,
  archivePantryItem
};
