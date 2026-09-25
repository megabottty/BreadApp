import { describe, it, expect } from 'vitest';
import {
  toGrams,
  fromGrams,
  normalizeIngredientName,
  lookupDefaultDensity,
  lookupDefaultItemGrams,
  parsePackageWeight
} from './units';

describe('toGrams — mass units (exact, no ingredient context needed)', () => {
  it('converts every mass unit using the exact standard factors', () => {
    expect(toGrams(1, 'g').grams).toBeCloseTo(1, 6);
    expect(toGrams(1, 'kg').grams).toBeCloseTo(1000, 6);
    expect(toGrams(1, 'oz').grams).toBeCloseTo(28.349523125, 6);
    expect(toGrams(1, 'lb').grams).toBeCloseTo(453.59237, 6);
  });

  it('always reports OK and never "assumed" for mass units, regardless of ingredient', () => {
    const result = toGrams(5, 'lb');
    expect(result.status).toBe('OK');
    expect(result.assumed).toBe(false);
  });

  it('scales linearly with amount', () => {
    expect(toGrams(2.5, 'kg').grams).toBeCloseTo(2500, 6);
  });
});

describe('toGrams — volume units derive from one grams-per-cup number', () => {
  it('resolves cup, tablespoon and teaspoon consistently from the same density', () => {
    const gramsPerCup = 120; // bread/AP flour
    const cup = toGrams(1, 'cup', { gramsPerCup });
    const tbsp = toGrams(16, 'tbsp', { gramsPerCup }); // 16 tbsp = 1 cup
    const tsp = toGrams(48, 'tsp', { gramsPerCup }); // 48 tsp = 1 cup

    expect(cup.grams).toBeCloseTo(120, 6);
    expect(tbsp.grams).toBeCloseTo(120, 6);
    expect(tsp.grams).toBeCloseTo(120, 6);
  });

  it('is not "assumed" when the caller supplies a specific density', () => {
    const result = toGrams(1, 'cup', { gramsPerCup: 127 });
    expect(result.status).toBe('OK');
    expect(result.assumed).toBe(false);
    expect(result.grams).toBeCloseTo(127, 6);
  });

  it('falls back to the generic density table by ingredient name, flagged as assumed', () => {
    const result = toGrams(1, 'cup', { ingredientName: 'Bread Flour' });
    expect(result.status).toBe('OK');
    expect(result.assumed).toBe(true);
    expect(result.grams).toBeCloseTo(127, 6);
  });

  it('still resolves (never blocks) an unknown ingredient with no density at all, using a generic fallback flagged MISSING_DENSITY', () => {
    const result = toGrams(1, 'cup', { ingredientName: 'Mystery Powder' });
    expect(result.status).toBe('MISSING_DENSITY');
    expect(result.assumed).toBe(true);
    expect(result.grams).toBeGreaterThan(0);
  });
});

describe('toGrams — count ("each")', () => {
  it('multiplies amount by the supplied per-item weight', () => {
    expect(toGrams(2, 'each', { gramsPerItem: 50 }).grams).toBeCloseTo(100, 6);
  });

  it('falls back to the generic per-item table by name, flagged as assumed', () => {
    const result = toGrams(1, 'each', { ingredientName: 'Egg' });
    expect(result.status).toBe('OK');
    expect(result.assumed).toBe(true);
    expect(result.grams).toBeCloseTo(50, 6);
  });

  it('reports MISSING_ITEM_WEIGHT (grams: 0) rather than guessing, when nothing is known', () => {
    const result = toGrams(2, 'each', { ingredientName: 'Mystery Widget' });
    expect(result.status).toBe('MISSING_ITEM_WEIGHT');
    expect(result.grams).toBe(0);
  });
});

describe('toGrams — invalid amounts', () => {
  it('rejects NaN, negative, and non-finite amounts instead of returning garbage', () => {
    expect(toGrams(NaN, 'g').status).toBe('INVALID_AMOUNT');
    expect(toGrams(-5, 'g').status).toBe('INVALID_AMOUNT');
    expect(toGrams(Infinity, 'g').status).toBe('INVALID_AMOUNT');
  });

  it('allows zero (an ingredient with no amount yet is not an error)', () => {
    expect(toGrams(0, 'g').status).toBe('OK');
    expect(toGrams(0, 'g').grams).toBe(0);
  });
});

describe('fromGrams — round trip with toGrams', () => {
  it('round-trips for every unit given a consistent context', () => {
    const ctx = { gramsPerCup: 120, gramsPerItem: 50 };
    for (const unit of ['g', 'kg', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'each'] as const) {
      const original = 3;
      const grams = toGrams(original, unit, ctx).grams;
      const back = fromGrams(grams, unit, ctx);
      expect(back).not.toBeNull();
      expect(back!).toBeCloseTo(original, 6);
    }
  });

  it('returns null rather than a garbage number when a volume/count unit has no resolvable basis', () => {
    expect(fromGrams(100, 'each', {})).toBeNull();
  });
});

describe('lookupDefaultDensity / lookupDefaultItemGrams — substring matching', () => {
  it('resolves a branded/qualified name via the generic ingredient it contains', () => {
    expect(lookupDefaultDensity('King Arthur Bread Flour')).toBe(127);
    expect(lookupDefaultDensity('Organic Unbleached All-Purpose Flour')).toBe(120);
  });

  it('prefers the more specific key over a shorter generic one', () => {
    // "bread flour" (127) should win over the bare "flour" fallback (120)
    expect(lookupDefaultDensity('Generic Bread Flour, 5lb bag')).toBe(127);
  });

  it('returns undefined for a name with no match', () => {
    expect(lookupDefaultDensity('Mystery Powder')).toBeUndefined();
    expect(lookupDefaultItemGrams('Mystery Widget')).toBeUndefined();
  });

  it('resolves per-item weight the same way', () => {
    expect(lookupDefaultItemGrams('2 Large Eggs')).toBe(50);
  });
});

describe('normalizeIngredientName — contract with the server (server/utils/pantry.cjs normalizeName)', () => {
  // Both implementations are (and must stay) exactly `String(name).trim().toLowerCase()`
  // so a pantry row saved by one resolves under the other.
  const cases: [string, string][] = [
    ['  Bread Flour  ', 'bread flour'],
    ['BREAD FLOUR', 'bread flour'],
    ['bread flour', 'bread flour'],
    ['\tKing Arthur\n', 'king arthur'],
    ['Café Sugar', 'café sugar'] // unicode passes through untouched, same as JS toLowerCase()
  ];

  it.each(cases)('normalizes %j to %j, matching String(name).trim().toLowerCase()', (input, expected) => {
    expect(normalizeIngredientName(input)).toBe(expected);
    expect(normalizeIngredientName(input)).toBe(String(input).trim().toLowerCase());
  });

  it('handles empty/undefined input without throwing', () => {
    expect(normalizeIngredientName('')).toBe('');
    expect(normalizeIngredientName(undefined as unknown as string)).toBe('');
  });
});

describe('parsePackageWeight', () => {
  it('parses USDA Branded packageWeight strings', () => {
    expect(parsePackageWeight('2 lb')).toEqual({ amount: 2, unit: 'lb' });
    expect(parsePackageWeight('907 g')).toEqual({ amount: 907, unit: 'g' });
    expect(parsePackageWeight('16 OZ')).toEqual({ amount: 16, unit: 'oz' });
    expect(parsePackageWeight('1.5 kg')).toEqual({ amount: 1.5, unit: 'kg' });
    expect(parsePackageWeight('3 pounds')).toEqual({ amount: 3, unit: 'lb' });
  });

  it('returns null for junk, empty, or unparseable input rather than guessing', () => {
    expect(parsePackageWeight('')).toBeNull();
    expect(parsePackageWeight(null)).toBeNull();
    expect(parsePackageWeight(undefined)).toBeNull();
    expect(parsePackageWeight('about 2 pounds')).toBeNull();
    expect(parsePackageWeight('a lot')).toBeNull();
    expect(parsePackageWeight('-5 g')).toBeNull();
  });
});
