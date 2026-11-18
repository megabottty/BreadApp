// describe/it/expect/vi come from vitest's globals (see vitest.config.ts).
const { requireBaker, isBakerOf, bakerTenantOf } = require('./auth.cjs');

const BAKERY = 'c6469f56-4072-4325-814c-ebe740684dbe';

/** A supabase stand-in whose getUser returns the user registered for each token. */
const fakeSupabase = (usersByToken) => ({
  auth: {
    getUser: async (token) => (usersByToken[token]
      ? { data: { user: usersByToken[token] }, error: null }
      : { data: null, error: { message: 'bad token' } })
  }
});

const users = {
  baker: { id: 'u-baker', app_metadata: { role: 'BAKER', tenant_id: BAKERY }, user_metadata: {} },
  // A customer who edited their own user_metadata to claim the bakery.
  impostor: { id: 'u-imp', app_metadata: {}, user_metadata: { role: 'BAKER', tenant_id: BAKERY } },
  customer: { id: 'u-cust', app_metadata: {}, user_metadata: {} }
};
const supabase = fakeSupabase(users);

const run = async (token, { tenantId } = {}) => {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, tenantId };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const next = vi.fn();
  await requireBaker(supabase)(req, res, next);
  return { req, res, next };
};

describe('bakerTenantOf', () => {
  it('reads only app_metadata', () => {
    expect(bakerTenantOf(users.baker)).toBe(BAKERY);
    expect(bakerTenantOf(users.impostor)).toBeNull();
    expect(bakerTenantOf(users.customer)).toBeNull();
    expect(bakerTenantOf(null)).toBeNull();
  });
});

describe('requireBaker', () => {
  it('lets the real baker in and pins the bakery to theirs', async () => {
    const { req, next } = await run('baker');
    expect(next).toHaveBeenCalled();
    expect(req.bakerTenantId).toBe(BAKERY);
    expect(req.tenantId).toBe(BAKERY);
  });

  it('refuses a customer who edited user_metadata to claim the bakery', async () => {
    const { res, next } = await run('impostor');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('refuses plain customers (403) and guests (401)', async () => {
    expect((await run('customer')).res.statusCode).toBe(403);
    expect((await run(null)).res.statusCode).toBe(401);
    expect((await run('garbage')).res.statusCode).toBe(401);
  });

  it('refuses the baker acting on a different bakery', async () => {
    const { res, next } = await run('baker', { tenantId: 'another-bakery' });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});

describe('isBakerOf', () => {
  const req = (token) => ({ headers: { authorization: `Bearer ${token}` } });
  it('is true only for the app_metadata baker of that bakery', async () => {
    expect(await isBakerOf(supabase, req('baker'), BAKERY)).toBe(true);
    expect(await isBakerOf(supabase, req('baker'), 'other')).toBe(false);
    expect(await isBakerOf(supabase, req('impostor'), BAKERY)).toBe(false);
    expect(await isBakerOf(supabase, { headers: {} }, BAKERY)).toBe(false);
  });
});
