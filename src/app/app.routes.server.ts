import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Public storefront routes render on the server so the initial HTML
  // already contains product data/images (fixes the CSR "load delay"
  // that was dominating LCP). These are public, unauthenticated pages
  // with per-request dynamic data, so full SSR (not prerender) is used.
  {
    path: 'front',
    renderMode: RenderMode.Server
  },
  {
    path: 'b/:slug',
    renderMode: RenderMode.Server
  },
  // Everything else (authenticated dashboard/admin pages, checkout, etc.)
  // keeps the existing client-side rendering behavior — these pages
  // require client-side Supabase auth state and aren't part of the
  // public LCP-sensitive path.
  {
    path: '**',
    renderMode: RenderMode.Client
  }
];
