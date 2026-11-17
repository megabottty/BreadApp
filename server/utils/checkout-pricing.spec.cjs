// describe/it/expect come from vitest's globals (see vitest.config.ts).
const {
  priceLines,
  computeDiscount,
  checkPickupDate,
  cleanCustomer,
  newOrderId,
  resolveAddons,
  CheckoutError
} = require('./checkout-pricing.cjs');
const { normalizePhone } = require('./phone.cjs');

const recipes = new Map([
  ['r-loaf', { id: 'r-loaf', name: 'Country Loaf', category: 'BREAD', price: 12, pack_options: [], item_weight_grams: 900 }],
  ['r-cookie', {
    id: 'r-cookie', name: 'Chocolate Chip Cookies', category: 'COOKIE', price: 4,
    pack_options: [{ id: 'single', label: 'Single', size: 1, price: 4 }, { id: '6-pack', label: '6 Pack', size: 6, price: 20 }],
    item_weight_grams: 80
  }],
  ['r-hidden', { id: 'r-hidden', name: 'Secret Loaf', category: 'BREAD', price: 1, is_hidden: true }],
  ['r-monkey', { id: 'r-monkey', name: 'Monkey Bread', category: 'BREAD', price: 15, pack_options: [] }]
]);

describe('priceLines', () => {
  it('prices from the recipe, not from anything the browser sends', () => {
    const result = priceLines([{ recipeId: 'r-loaf', quantity: 2, price: 0.01 }], recipes);
    expect(result.lines[0].unitPrice).toBe(12);
    expect(result.subtotal).toBe(24);
  });

  it('uses the chosen pack, and counts items baked as packs x size', () => {
    const { lines, subtotal } = priceLines([{ recipeId: 'r-cookie', packOptionId: '6-pack', quantity: 2 }], recipes);
    expect(lines[0]).toMatchObject({ packCount: 2, packSize: 6, quantity: 12, unitPrice: 20, lineTotal: 40, weightGrams: 960 });
    expect(lines[0].name).toBe('Chocolate Chip Cookies (6 Pack)');
    expect(subtotal).toBe(40);
  });

  it('falls back to the first pack when the chosen one no longer exists', () => {
    const { lines } = priceLines([{ recipeId: 'r-cookie', packOptionId: 'gone', quantity: 1 }], recipes);
    expect(lines[0].unitPrice).toBe(4);
  });

  it('adds only add-ons the recipe allows, at the bakery price', () => {
    const { lines } = priceLines([{ recipeId: 'r-loaf', quantity: 1, addons: ['Sliced', 'Free gold'] }], recipes);
    expect(lines[0].unitPrice).toBe(14);
    expect(lines[0].addons).toEqual([{ name: 'Sliced', price: 2 }]);
  });

  it('never offers slicing on monkey bread', () => {
    expect(resolveAddons(recipes.get('r-monkey'))).toEqual([]);
  });

  it.each([0, -1, 1.5, 51, 'abc'])('rejects quantity %s', (quantity) => {
    expect(() => priceLines([{ recipeId: 'r-loaf', quantity }], recipes)).toThrow(CheckoutError);
  });

  it('rejects hidden or unknown recipes and empty bags', () => {
    expect(() => priceLines([{ recipeId: 'r-hidden', quantity: 1 }], recipes)).toThrow(/no longer available/);
    expect(() => priceLines([{ recipeId: 'nope', quantity: 1 }], recipes)).toThrow(/no longer available/);
    expect(() => priceLines([], recipes)).toThrow(/empty/);
  });

  it('flags subscriptions', () => {
    expect(priceLines([{ recipeId: 'r-loaf', quantity: 1, isSubscription: true }], recipes).hasSubscription).toBe(true);
  });
});

describe('computeDiscount', () => {
  const { lines, subtotal } = priceLines([
    { recipeId: 'r-loaf', quantity: 1 },
    { recipeId: 'r-cookie', packOptionId: '6-pack', quantity: 1 }
  ], recipes);

  it('fixed and percent promos', () => {
    expect(computeDiscount({ promo: { type: 'FIXED', value: 5 }, lines, subtotal }).discount).toBe(5);
    expect(computeDiscount({ promo: { type: 'PERCENT', value: 10 }, lines, subtotal }).discount).toBe(3.2);
  });

  it('free loaf takes off the cheapest single item', () => {
    // cookies: $20 / 6 = $3.33 each, cheaper than the $12 loaf
    expect(computeDiscount({ promo: { type: 'FREE_LOAF', value: 0 }, lines, subtotal }).discount).toBe(3.33);
  });

  it('ignores inactive promos, and never discounts below zero', () => {
    expect(computeDiscount({ promo: { type: 'FIXED', value: 5, is_active: false }, lines, subtotal }).discount).toBe(0);
    expect(computeDiscount({ promo: { type: 'FIXED', value: 500 }, lines, subtotal }).discount).toBe(32);
  });

  it('loyalty adds $8', () => {
    expect(computeDiscount({ promo: null, lines, subtotal, loyaltyEligible: true })).toMatchObject({ loyaltyDiscount: 8, discount: 8 });
  });
});

describe('checkPickupDate', () => {
  const today = '2026-11-16'; // a Monday

  it('needs at least two days', () => {
    expect(checkPickupDate('2026-11-17', { today })).toMatch(/48 hours/);
    expect(checkPickupDate('2026-11-18', { today })).toBeNull();
  });

  it('subscriptions only on Monday or Tuesday', () => {
    expect(checkPickupDate('2026-11-19', { today, hasSubscription: true })).toMatch(/Monday or Tuesday/);
    expect(checkPickupDate('2026-11-23', { today, hasSubscription: true })).toBeNull();
    expect(checkPickupDate('2026-11-24', { today, hasSubscription: true })).toBeNull();
  });

  it('rejects junk and far-off dates', () => {
    expect(checkPickupDate('tomorrow', { today })).toBeTruthy();
    expect(checkPickupDate('2027-06-01', { today })).toMatch(/next few months/);
  });
});

describe('cleanCustomer', () => {
  const ok = { name: ' Ada ', email: 'ADA@example.com', phone: '801-555-0123', notificationPreference: 'BOTH', notes: 'x'.repeat(600) };

  it('trims, lower-cases email, and caps notes', () => {
    const c = cleanCustomer(ok, { normalizePhone });
    expect(c.name).toBe('Ada');
    expect(c.email).toBe('ada@example.com');
    expect(c.notes.length).toBe(450);
  });

  it('requires the contact method they chose', () => {
    expect(() => cleanCustomer({ ...ok, email: '' }, { normalizePhone })).toThrow(/email/);
    expect(() => cleanCustomer({ ...ok, phone: '', notificationPreference: 'SMS' }, { normalizePhone })).toThrow(/phone/);
    expect(() => cleanCustomer({ ...ok, phone: '555' }, { normalizePhone })).toThrow(/phone/);
    expect(() => cleanCustomer({ ...ok, name: '  ' }, { normalizePhone })).toThrow(/name/);
  });
});

describe('newOrderId', () => {
  it('is stable for the same checkout attempt and different otherwise', () => {
    const key = '3f1c2b7e-9a1d-4e2b-8c3f-5d6e7f8a9b0c';
    expect(newOrderId(key)).toBe(newOrderId(key));
    expect(newOrderId(key)).not.toBe(newOrderId('11111111-2222-3333-4444-555555555555'));
    expect(newOrderId()).toMatch(/^DD-[A-Z2-9]{10}$/);
    expect(newOrderId()).not.toBe(newOrderId());
  });
});
