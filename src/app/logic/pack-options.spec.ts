import { describe, it, expect } from 'vitest';
import { resolvePackOptions, getStartingPrice } from './pack-options';

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
