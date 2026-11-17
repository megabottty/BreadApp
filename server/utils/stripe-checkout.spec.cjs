// describe/it/expect/vi come from vitest's globals (see vitest.config.ts).
const { fulfillCheckoutSession, buildSessionParams } = require('./stripe-checkout.cjs');

/** A tiny in-memory stand-in for the parts of supabase-js the fulfiller uses. */
function fakeSupabase({ failOrderInsert = false } = {}) {
  const tables = { bakery_orders: [], bakery_subscriptions: [], bakery_tenants: [{ id: 't1', slug: 'thedailydough' }] };
  const builder = (table) => {
    const filters = [];
    let limitN = null;
    const rows = () => tables[table].filter(r => filters.every(([k, v]) => r[k] === v)).slice(0, limitN ?? undefined);
    const api = {
      select: () => api,
      eq: (k, v) => { filters.push([k, v]); return api; },
      limit: (n) => { limitN = n; return Promise.resolve({ data: rows(), error: null }); },
      maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
      insert: (input) => {
        const list = Array.isArray(input) ? input : [input];
        if (table === 'bakery_orders') {
          if (failOrderInsert) return withSelect({ error: { code: '500', message: 'db down' } });
          if (list.some(r => tables.bakery_orders.some(o => o.order_id === r.order_id))) {
            return withSelect({ error: { code: '23505', message: 'duplicate' } });
          }
        }
        const saved = list.map((r, i) => ({ id: `${table}-${tables[table].length + i}`, ...r }));
        tables[table].push(...saved);
        return withSelect({ data: saved, error: null });
      }
    };
    return api;
  };
  const withSelect = (result) => Object.assign(Promise.resolve(result), { select: () => Promise.resolve(result) });
  return { from: builder, tables };
}

const fakeStripe = {
  checkout: {
    sessions: {
      listLineItems: async () => ({
        data: [
          {
            quantity: 2,
            description: 'Country Loaf',
            amount_subtotal: 2400,
            price: { unit_amount: 1200, recurring: { interval: 'week' }, product: { name: 'Country Loaf', metadata: { recipeId: 'r-loaf', packSize: '1', packWeightGrams: '900', sub: '1' } } }
          },
          {
            quantity: 1,
            description: 'Cookies (6 Pack)',
            amount_subtotal: 2000,
            price: { unit_amount: 2000, product: { name: 'Cookies (6 Pack)', metadata: { recipeId: 'r-cookie', packSize: '6', packWeightGrams: '480', sub: '0' } } }
          }
        ]
      })
    }
  },
  paymentIntents: { retrieve: async () => ({ latest_charge: { payment_method_details: { card: { brand: 'visa', last4: '4242' } } } }) }
};

const paidSession = (overrides = {}) => ({
  id: 'cs_test_123',
  mode: 'subscription',
  subscription: 'sub_1',
  payment_status: 'paid',
  status: 'complete',
  amount_total: 4400,
  metadata: { orderId: 'DD-ABCDEFGHJK', tenantId: 't1', customerId: 'user-1234567890', customerName: 'Ada', customerPhone: '8015550123', customerEmail: 'ada@example.com', notificationPreference: 'BOTH', pickupDate: '2026-11-23' },
  ...overrides
});

describe('fulfillCheckoutSession', () => {
  it('saves one order and one subscription per weekly line, from Stripe line items', async () => {
    const supabase = fakeSupabase();
    const notify = { onNewOrder: vi.fn(async () => {}), onNewSubscriptions: vi.fn(async () => {}) };
    const result = await fulfillCheckoutSession({ stripe: fakeStripe, supabase, notify }, paidSession());

    expect(result).toMatchObject({ orderId: 'DD-ABCDEFGHJK', created: true });
    const [order] = supabase.tables.bakery_orders;
    expect(order).toMatchObject({ order_id: 'DD-ABCDEFGHJK', total_price: 44, payment_status: 'PAID', tenant_id: 't1' });
    expect(order.items[1]).toMatchObject({ recipeId: 'r-cookie', packCount: 1, packSize: 6, quantity: 6, lineTotal: 20 });
    expect(supabase.tables.bakery_subscriptions).toHaveLength(1);
    expect(supabase.tables.bakery_subscriptions[0]).toMatchObject({ recipe_id: 'r-loaf', quantity: 2, price: 24, next_bake_date: '2026-11-23', pickup_weekday: 1 });
    expect(notify.onNewOrder).toHaveBeenCalledTimes(1);
    expect(notify.onNewOrder.mock.calls[0][1].subscriptionNoticeSent).toBe(true);
  });

  it('is safe to run again (Stripe retry, or the confirmation page after the webhook)', async () => {
    const supabase = fakeSupabase();
    const notify = { onNewOrder: vi.fn(async () => {}), onNewSubscriptions: vi.fn(async () => {}) };
    await fulfillCheckoutSession({ stripe: fakeStripe, supabase, notify }, paidSession());
    const again = await fulfillCheckoutSession({ stripe: fakeStripe, supabase, notify }, paidSession());

    expect(again.created).toBe(false);
    expect(supabase.tables.bakery_orders).toHaveLength(1);
    expect(supabase.tables.bakery_subscriptions).toHaveLength(1);
    expect(notify.onNewOrder).toHaveBeenCalledTimes(1);
  });

  it('throws when the order cannot be saved, so the webhook answers 500 and Stripe retries', async () => {
    const supabase = fakeSupabase({ failOrderInsert: true });
    await expect(fulfillCheckoutSession({ stripe: fakeStripe, supabase }, paidSession())).rejects.toThrow(/Order insert failed/);
  });

  it('does nothing for an unpaid session', async () => {
    const supabase = fakeSupabase();
    const result = await fulfillCheckoutSession({ stripe: fakeStripe, supabase }, paidSession({ payment_status: 'unpaid', status: 'open' }));
    expect(result.unpaid).toBe(true);
    expect(supabase.tables.bakery_orders).toHaveLength(0);
  });

  it('finds the bakery by slug for sessions started before tenantId was stored', async () => {
    const supabase = fakeSupabase();
    const session = paidSession({ mode: 'payment', subscription: null, payment_intent: 'pi_1' });
    session.metadata = { ...session.metadata, tenantId: undefined, tenantSlug: 'the-daily-dough' };
    const result = await fulfillCheckoutSession({ stripe: fakeStripe, supabase }, session);
    expect(result.tenantId).toBe('t1');
    expect(supabase.tables.bakery_orders[0].payment_method).toEqual({ brand: 'visa', last4: '4242' });
  });
});

describe('buildSessionParams', () => {
  const quote = {
    orderId: 'DD-ABCDEFGHJK',
    hasSubscription: false,
    lines: [{ recipeId: 'r-loaf', name: 'Country Loaf', packCount: 2, packSize: 1, unitPrice: 12, weightGrams: 1800, isSubscription: false }],
    customer: { name: 'Ada', phone: '', email: 'ada@example.com', notes: 'n'.repeat(600), notificationPreference: 'EMAIL' },
    pickupDate: '2026-11-20',
    promo: { code: 'SPRING' },
    discount: 5,
    subtotal: 24
  };

  it('charges server prices, applies the discount coupon, and keeps metadata under Stripe limits', () => {
    const params = buildSessionParams({ quote, tenantId: 't1', customerId: null, frontendUrl: 'https://shop.example', couponId: 'co_1' });
    expect(params.line_items[0]).toMatchObject({ quantity: 2, price_data: { unit_amount: 1200 } });
    expect(params.discounts).toEqual([{ coupon: 'co_1' }]);
    expect(params.success_url).toBe('https://shop.example/order-success/DD-ABCDEFGHJK?session_id={CHECKOUT_SESSION_ID}');
    expect(Object.values(params.metadata).every(v => String(v).length <= 500)).toBe(true);
    expect(params.metadata.customerId).toBe('guest');
  });
});
