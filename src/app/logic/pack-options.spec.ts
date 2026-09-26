import { describe, it, expect } from 'vitest';
import { resolvePackOptions, getStartingPrice, calculatePackEconomics } from './pack-options';
import { calculateBakersMath, Recipe } from './bakers-math';

describe('resolvePackOptions', () => {
  it('prefers pack options saved on the product', () => {
    const custom = [{ id: '3-pack', label: 'Trio', size: 3, price: 7 }];
    expect(resolvePackOptions({ name: 'Cookie', category: 'COOKIE', packOptions: custom })).toBe(custom);
  });

  it('never invents packs from the category or name -- the saved price wins', () => {
    // A $6 "Cinnamon Roll" and a $20 "Cinnamon Rolls 4 Pack" used to both
    // come back as a hard-coded 1/$5, 2/$10, 4/$18 table.
    expect(resolvePackOptions({ name: 'Cinnamon Roll', category: 'OTHER', price: 6 })).toEqual([]);
    expect(resolvePackOptions({ name: 'Cinnamon Rolls 4 Pack', category: 'OTHER', price: 20 })).toEqual([]);
    expect(resolvePackOptions({ name: 'Everything Bagels', category: 'BAGEL', price: 3 })).toEqual([]);
    expect(resolvePackOptions({ name: 'Chocolate Chip', category: 'COOKIE', price: 3 })).toEqual([]);
  });

  it('returns no packs for plain bread', () => {
    expect(resolvePackOptions({ name: 'Country Loaf', category: 'BREAD', price: 12 })).toEqual([]);
  });
});

describe('getStartingPrice', () => {
  it('uses the base price when there are no packs', () => {
    expect(getStartingPrice({ name: 'Loaf', category: 'BREAD', price: 14 })).toEqual({ price: 14, isFrom: false });
  });

  it('uses the saved price for products that used to hit the hard-coded table', () => {
    expect(getStartingPrice({ name: 'Cinnamon Roll', category: 'OTHER', price: 6 })).toEqual({ price: 6, isFrom: false });
    expect(getStartingPrice({ name: 'Cinnamon Rolls 4 Pack', category: 'OTHER', price: 20 })).toEqual({ price: 20, isFrom: false });
  });

  it('uses the cheapest saved pack otherwise', () => {
    const packOptions = [
      { id: '4-pack', label: '4 Bagels', size: 4, price: 12 },
      { id: '8-pack', label: '8 Bagels', size: 8, price: 20 }
    ];
    expect(getStartingPrice({ name: 'Plain Bagels', category: 'BAGEL', price: 2, packOptions })).toEqual({ price: 12, isFrom: true });
  });

  it('shows $0 rather than a made-up price when a product has no price yet', () => {
    expect(getStartingPrice({ name: 'Loaf', category: 'BREAD' })).toEqual({ price: 0, isFrom: false });
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

  it('has no pack economics when the recipe has no packs of its own, whatever its category', () => {
    const recipe = calculateBakersMath(oneItemFlourRecipe); // COOKIE, no packOptions set
    expect(calculatePackEconomics(recipe)).toEqual([]);
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
