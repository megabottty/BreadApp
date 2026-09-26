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

/** A signed-in BAKER, and (when the route resolved a tenant) the baker of that tenant. */
const requireBaker = (supabase) => async (req, res, next) => {
  const result = await resolveUser(supabase, req);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const meta = result.user.user_metadata || {};
  if (meta.role !== 'BAKER') {
    return res.status(403).json({ error: 'Only the baker can do that' });
  }
  if (req.tenantId && meta.tenant_id && meta.tenant_id !== req.tenantId) {
    return res.status(403).json({ error: 'Only the baker can do that' });
  }
  req.customerId = result.user.id;
  req.authUser = result.user;
  next();
};

module.exports = { requireCustomer, requireBaker, readBearer };
