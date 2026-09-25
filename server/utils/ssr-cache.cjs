/**
 * In-memory cache of server-rendered storefront HTML.
 *
 * Rendering the storefront on the server costs ~1s (Angular render + three
 * Supabase queries), which dominated mobile TTFB. Public pages are identical
 * for every visitor, so the rendered HTML is kept per URL and reused until a
 * write that could change it (recipe/tenant save) calls `invalidate()`.
 */
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 50;

const cache = new Map();

function get(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.html;
}

function set(key, html) {
  if (cache.size >= MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), html });
}

function invalidate() {
  cache.clear();
}

module.exports = { get, set, invalidate };
