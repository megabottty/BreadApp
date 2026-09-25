import { describe, it, expect } from 'vitest';
import { resolvePackOptions, getStartingPrice, calculatePackEconomics } from './pack-options';
import { calculateBakersMath, Recipe } from './bakers-math';

describe('resolvePackOptions', () => {
  it('prefers pack options saved on the product', () => {
    const custom = [{ id: '3-pack', label: 'Trio', size: 3, price: 7 }];
    expect(resolvePackOptions({ name: 'Cookie', category: 'COOKIE', packOptions: custom })).toBe(custom);
  });

  it('prices bagels as 4-pack $12 / 8-pack $20', () => {
    const packs = resolvePackOptions({ name: 'Everything Bagels', category: 'BAGEL' });
    expect(packs.map(p => [p.size, p.price])).toEqual([[4, 12], [8, 20]]);
  });

  it('adds $2 per pack for blueberry bagels', () => {
    const packs = resolvePackOptions({ name: 'Blueberry Bagels', category: 'BAGEL' });
    expect(packs.map(p => [p.size, p.price])).toEqual([[4, 14], [8, 22]]);
  });

  it('prices cookies as 1/$3, 6/$10, 12/$20', () => {
    const packs = resolvePackOptions({ name: 'Chocolate Chip', category: 'COOKIE' });
    expect(packs.map(p => [p.size, p.price])).toEqual([[1, 3], [6, 10], [12, 20]]);
  });

  it('returns no packs for plain bread', () => {
    expect(resolvePackOptions({ name: 'Country Loaf', category: 'BREAD', price: 12 })).toEqual([]);
  });
});

describe('getStartingPrice', () => {
  it('uses the base price when there are no packs', () => {
    expect(getStartingPrice({ name: 'Loaf', category: 'BREAD', price: 14 })).toEqual({ price: 14, isFrom: false });
  });

  it('uses the cheapest pack otherwise', () => {
    expect(getStartingPrice({ name: 'Plain Bagels', category: 'BAGEL', price: 2 })).toEqual({ price: 12, isFrom: true });
  });
});

describe('calculatePackEconomics', () => {
  const oneItemFlourRecipe: Recipe = {
    name: 'Chocolate Chip',
    category: 'COOKIE',
    price: 12,
    // 100g flour at $1/1000g = $0.10 total cost for the one item this recipe makes
    ingredients: [{ name: 'Flour', weight: 100, type: 'FLOUR', bulkPrice: 1, bulkWeight: 1000 }]
  };

  it('costs and margins an explicit pack option against the recipe cost, not the batch price', () => {
    const recipe = calculateBakersMath({
      ...oneItemFlourRecipe,
      packOptions: [{ id: '6-pack', label: '6 Cookies', size: 6, price: 10 }]
    });
    const [economics] = calculatePackEconomics(recipe);

    expect(economics.cost).toBeCloseTo(0.1 * 6, 6);
    expect(economics.profit).toBeCloseTo(10 - 0.6, 6);
    expect(economics.margin).toBeCloseTo(94, 6);
    expect(economics.pricePerItem).toBeCloseTo(10 / 6, 6);
    expect(economics.costPerItem).toBeCloseTo(0.1, 6);
  });

  it('falls back to the category default packs when the recipe has none of its own', () => {
    const recipe = calculateBakersMath(oneItemFlourRecipe); // no packOptions set
    const economics = calculatePackEconomics(recipe);

    // Matches resolvePackOptions' COOKIE defaults: 1/$3, 6/$10, 12/$20
    expect(economics.map(e => [e.size, e.price])).toEqual([[1, 3], [6, 10], [12, 20]]);
    expect(economics[1].cost).toBeCloseTo(0.1 * 6, 6);
  });

  it('does not divide by zero when a pack price is 0', () => {
    const recipe = calculateBakersMath({
      ...oneItemFlourRecipe,
      packOptions: [{ id: 'free-sample', label: 'Free Sample', size: 1, price: 0 }]
    });
    const [economics] = calculatePackEconomics(recipe);

    expect(economics.margin).toBe(0);
    expect(Number.isFinite(economics.margin)).toBe(true);
  });

  it('returns no pack economics for a plain loaf with no packs', () => {
    const recipe = calculateBakersMath({ ...oneItemFlourRecipe, category: 'BREAD' });
    expect(calculatePackEconomics(recipe)).toEqual([]);
  });
});
