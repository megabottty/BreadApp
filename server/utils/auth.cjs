/**
 * Supabase-JWT auth middleware for customer- and baker-owned routes.
 *
 * The frontend attaches the current session's access token as
 * `Authorization: Bearer <jwt>` (see src/app/interceptors/auth-token.interceptor.ts).
 * We verify it with the same Supabase client the route already has, so the
 * server never has to know the JWT secret.
 */

const readBearer = (req) => {
  const header = req.headers['authorization'] || req.headers['Authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

const resolveUser = async (supabase, req) => {
  if (!supabase) return { error: 'Database connection not configured', status: 500 };
  const token = readBearer(req);
  if (!token) return { error: 'Please log in', status: 401 };
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return { error: 'Please log in', status: 401 };
    return { user: data.user };
  } catch (err) {
    console.error('[Auth] Token verification failed:', err.message);
    return { error: 'Please log in', status: 401 };
  }
};

/** Any signed-in user. Sets req.customerId (= auth user id) and req.authUser. */
const requireCustomer = (supabase) => async (req, res, next) => {
  const result = await resolveUser(supabase, req);
  if (result.error) return res.status(result.status).json({ error: result.error });
  req.customerId = result.user.id;
  req.authUser = result.user;
  next();
};

/**
 * Who the baker is comes ONLY from app_metadata ({ role: 'BAKER', tenant_id }),
 * which can be set by the server (service key) but not by the user. Never
 * from user_metadata: any signed-in user can edit that about themselves.
 * Set it with server/scripts/set-baker.cjs.
 */
const bakerTenantOf = (user) => {
  const meta = (user && user.app_metadata) || {};
  return meta.role === 'BAKER' && typeof meta.tenant_id === 'string' && meta.tenant_id ? meta.tenant_id : null;
};

/**
 * A signed-in BAKER. Sets req.bakerTenantId (the bakery they run) -- routes
 * must scope reads/writes to that, never to a header or body value. When the
 * route already resolved a tenant (req.tenantId from x-tenant-slug), it must match.
 */
const requireBaker = (supabase) => async (req, res, next) => {
  const result = await resolveUser(supabase, req);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const tenantId = bakerTenantOf(result.user);
  if (!tenantId || (req.tenantId && req.tenantId !== tenantId)) {
    return res.status(403).json({ error: 'Only the baker can do that' });
  }
  req.bakerTenantId = tenantId;
  req.tenantId = req.tenantId || tenantId;
  req.customerId = result.user.id;
  req.authUser = result.user;
  next();
};

/**
 * Non-blocking check: is the caller the signed-in baker of tenantId?
 * Used by routes that serve both customers and the baker (e.g. POST /orders,
 * where only the baker's till may record a payment).
 */
const isBakerOf = async (supabase, req, tenantId) => {
  if (!readBearer(req)) return false;
  const result = await resolveUser(supabase, req);
  if (result.error) return false;
  const bakerTenant = bakerTenantOf(result.user);
  return !!bakerTenant && (!tenantId || bakerTenant === tenantId);
};

/** The verified signed-in user, or null for a guest (never throws). */
const optionalUser = async (supabase, req) => {
  if (!readBearer(req)) return null;
  const result = await resolveUser(supabase, req);
  return result.error ? null : result.user;
};

module.exports = { requireCustomer, requireBaker, readBearer, isBakerOf, optionalUser, bakerTenantOf };
