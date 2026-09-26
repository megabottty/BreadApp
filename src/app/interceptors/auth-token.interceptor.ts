import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * Adds `Authorization: Bearer <supabase access token>` to our own API calls
 * so customer-owned routes (subscription skips, notification preferences)
 * can verify who is asking.
 *
 * Deliberately reads the token from Supabase's localStorage session instead
 * of injecting AuthService: AuthService (via TenantService) makes HTTP calls
 * while it is being constructed, so injecting it from an interceptor is a
 * circular dependency (NG0200). supabase-js keeps the session under
 * `sb-<project-ref>-auth-token`.
 */
const isAppApiRequest = (url: string): boolean =>
  url.startsWith(environment.apiUrl) || url.startsWith('/api');

interface StoredSession {
  access_token?: string;
  expires_at?: number;
}

function readStoredAccessToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  const ref = /^https?:\/\/([^.]+)\./.exec(environment.supabaseUrl)?.[1];
  if (!ref) return null;
  try {
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (!session.access_token) return null;
    // Skip a clearly expired token; supabase-js will refresh it shortly.
    if (session.expires_at && session.expires_at * 1000 < Date.now() - 30_000) return null;
    return session.access_token;
  } catch {
    return null;
  }
}

export const authTokenInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isAppApiRequest(req.url) || req.headers.has('Authorization')) {
    return next(req);
  }
  const token = readStoredAccessToken();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};
