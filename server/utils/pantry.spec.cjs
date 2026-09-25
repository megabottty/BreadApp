// describe/it/expect come from vitest's globals (see vitest.config.ts) --
// this file can't `require('vitest')` directly from CommonJS.
const {
  normalizeName,
  resolveCostPerGram,
  formatPantryRow,
  toPantryColumns
} = require('./pantry.cjs');

describe('pantry.cjs normalizeName', () => {
  it('trims and lowercases', () => {
    expect(normalizeName('  Bread Flour  ')).toBe('bread flour');
  });

  it('treats different casing as the same key', () => {
    expect(normalizeName('BREAD FLOUR')).toBe(normalizeName('bread flour'));
  });

  it('handles missing/non-string input without throwing', () => {
    expect(normalizeName(undefined)).toBe('');
    expect(normalizeName(null)).toBe('');
  });
});

describe('pantry.cjs resolveCostPerGram (mirrors bakers-math.ts precedence)', () => {
  it('prefers the bulk pack basis when bulk_weight > 0', () => {
    const result = resolveCostPerGram({ bulk_price: 15, bulk_weight: 5000, cost_per_unit: 999 });
    expect(result.costBasis).toBe('PACK');
    expect(result.costPerGram).toBeCloseTo(0.003, 6);
  });

  it('falls back to the legacy per-100g cost when there is no bulk basis', () => {
    const result = resolveCostPerGram({ cost_per_unit: 0.2 });
    expect(result.costBasis).toBe('LEGACY');
    expect(result.costPerGram).toBeCloseTo(0.002, 6);
  });

  it('does not divide by zero when bulk_weight is 0', () => {
    const result = resolveCostPerGram({ bulk_price: 15, bulk_weight: 0, cost_per_unit: 0.1 });
    expect(Number.isFinite(result.costPerGram)).toBe(true);
    expect(result.costBasis).toBe('LEGACY');
  });

  it('reports MISSING when there is no price at all', () => {
    const result = resolveCostPerGram({});
    expect(result.costBasis).toBe('MISSING');
    expect(result.costPerGram).toBe(0);
  });
});

describe('pantry.cjs formatPantryRow / toPantryColumns round-trip', () => {
  it('maps a DB row into the camelCase shape the frontend expects', () => {
    const row = {
      id: 1,
      name: 'Bread Flour',
      normalized_name: 'bread flour',
      bulk_price: 15,
      bulk_weight: 5000,
      cost_per_unit: null,
      pack_size: 5,
      pack_unit: 'lb',
      default_use_unit: 'g',
      grams_per_cup: 120,
      grams_per_item: null,
      default_type: 'FLOUR',
      nutrition: { caloriesPer100g: 364, proteinPer100g: 12, carbsPer100g: 76, fatPer100g: 1.5 },
      nutrition_source: 'USDA',
      usda_fdc_id: '12345',
      is_archived: false,
      updated_at: '2026-01-01T00:00:00Z'
    };
    const formatted = formatPantryRow(row);
    expect(formatted.name).toBe('Bread Flour');
    expect(formatted.packUnit).toBe('lb');
    expect(formatted.gramsPerCup).toBe(120);
    expect(formatted.costBasis).toBe('PACK');
    expect(formatted.costPerGram).toBeCloseTo(0.003, 6);
  });

  it('toPantryColumns only includes keys that were actually provided (partial-patch safe)', () => {
    const columns = toPantryColumns({ bulkPrice: 15 });
    expect(columns).toEqual({ bulk_price: 15 });
    expect('nutrition' in columns).toBe(false);
    expect('grams_per_cup' in columns).toBe(false);
  });

  it('toPantryColumns passes through every known field when provided', () => {
    const columns = toPantryColumns({
      bulkPrice: 15,
      bulkWeight: 5000,
      costPerUnit: 0.1,
      packSize: 5,
      packUnit: 'lb',
      defaultUseUnit: 'g',
      gramsPerCup: 120,
      gramsPerItem: 50,
      defaultType: 'FLOUR',
      nutrition: { caloriesPer100g: 1 },
      nutritionSource: 'USDA',
      usdaFdcId: 'abc',
      isArchived: true
    });
    expect(columns).toEqual({
      bulk_price: 15,
      bulk_weight: 5000,
      cost_per_unit: 0.1,
      pack_size: 5,
      pack_unit: 'lb',
      default_use_unit: 'g',
      grams_per_cup: 120,
      grams_per_item: 50,
      default_type: 'FLOUR',
      nutrition: { caloriesPer100g: 1 },
      nutrition_source: 'USDA',
      usda_fdc_id: 'abc',
      is_archived: true
    });
  });
});
