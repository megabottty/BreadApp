import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpContext, HttpContextToken } from '@angular/common/http';
import { environment } from '../../environments/environment';

export const SKIP_NOTIFICATION = new HttpContextToken<boolean>(() => false);

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  business_type?: 'BAKERY' | 'RETAIL' | 'RESTAURANT';
  description?: string;
  logo_url?: string;
  primary_color: string;
  secondary_color: string;
  oven_capacity?: number;
  default_bake_temp?: number;
  default_steam_time?: number;
  default_bake_time?: string;
  address?: string;
  phone?: string;
  email?: string;
  stripe_account_id?: string;
  subscription_status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'TRIAL_BYPASS';
  subscription_plan?: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  subscription_id?: string;
  onboarding_completed?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class TenantService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  private currentTenant = signal<Tenant | null>(null);
  tenant = computed(() => this.currentTenant());

  constructor() {
    this.identifyTenant();
  }

  private identifyTenant() {
    // Logic to identify tenant from URL
    const host = window.location.hostname;
    const path = window.location.pathname;

  let slug = 'thedailydough'; // Updated default to match registered slug

    // Check if we have a saved slug from registration
    const savedSlug = localStorage.getItem('bakery_slug');
    if (savedSlug) {
      slug = savedSlug;
    }

    // Path-based logic: /b/slug/...
    if (path.startsWith('/b/')) {
      const parts = path.split('/');
      if (parts[2]) {
        slug = parts[2];
      }
    } else if (host !== 'localhost' && !host.includes('bluehost.com')) {
      // thedailydough.store is the main landing/app domain, but it's also a valid tenant slug
      if (host === 'thedailydough.store') {
        slug = 'thedailydough';
      } else {
        // Subdomain logic: slug.daily-dough.com or slug.thedailydough.store
        const parts = host.split('.');

        // If we have at least two parts, the first might be a slug
        if (parts.length >= 2) {
          const potentialSlug = parts[0].toLowerCase();

          // Define system-reserved prefixes that are NOT bakery slugs
          const systemPrefixes = ['www', 'thedailydough', 'dailydough', 'app', 'api', 'admin'];

          // If the first part isn't a system prefix, it's likely a baker's custom slug
          if (!systemPrefixes.includes(potentialSlug)) {
            slug = potentialSlug;
          }
        }
      }
    }

    // Only defer loading on explicit auth routes.
    // "/" immediately redirects to "/front", so we should still preload tenant there.
    const isRegistrationOrLogin = path.includes('/register') || path.includes('/login');

    if (savedSlug) {
      this.loadTenantInfo(savedSlug);
    } else if (!isRegistrationOrLogin) {
      // If we are on a specific route that isn't the home/auth pages, try to load the default
      this.loadTenantInfo(slug);
    } else {
      console.log('[Tenant Service] Auth route detected - waiting for registration/login to confirm tenant.');
    }
  }

  loadTenantInfo(slug: string) {
    if (!slug) {
      return;
    }

    // Clean slug
    slug = slug.replace(/\/$/, '').trim().toLowerCase();

    // If already loading/loaded this slug, skip unless forced or current is null
    if (this.currentTenant()?.slug === slug) {
      return;
    }

    console.log(`[TenantService] Loading info for slug: ${slug}`);

    // Use absolute URL if on localhost to ensure we hit the backend
    const url = window.location.hostname === 'localhost'
      ? `http://localhost:3000/api/orders/info`
      : `${this.apiUrl}/orders/info`;

    this.http.get<Tenant>(url, {
      headers: { 'x-tenant-slug': slug },
      context: new HttpContext().set(SKIP_NOTIFICATION, true)
    }).subscribe({
      next: (tenant) => {
        console.log(`[TenantService] Tenant info loaded:`, tenant);
        this.currentTenant.set(tenant);
        this.applyBranding(tenant);
      },
      error: (err) => {
        // Handle connection refused or other network errors silently if we want to reduce noise
        if (err.status === 0) {
          console.warn('[TenantService] Backend server is not reachable. Please ensure the backend is running (npm run server).');
          return;
        }
        // If it's a 404, we don't want to spam error logs, just a warning is enough
        if (err.status === 404) {
          this.currentTenant.set(null);
          // No warning needed for the default tenant if not found, it might be the first run
          if (slug !== 'thedailydough') {
            console.warn(`[TenantService] Bakery not found for slug: ${slug}. This usually means the bakery hasn't been registered yet.`);
          }
        } else {
          this.currentTenant.set(null);
          console.error(`[TenantService] Failed to load tenant info for slug: ${slug}`, err);
        }
      }
    });
  }

  registerBakery(name: string, slug: string) {
    return this.http.post<Tenant>(`${this.apiUrl}/orders/register-bakery`, { name, slug });
  }

  updateTenantBranding(id: string, primary: string, secondary: string, oven_capacity: number = 6, address?: string, phone?: string, email?: string, business_type: string = 'BAKERY') {
    return this.updateTenant(id, {
      primary_color: primary,
      secondary_color: secondary,
      oven_capacity: oven_capacity,
      address: address,
      phone: phone,
      email: email,
      business_type: business_type as any
    });
  }

  updateTenant(id: string, updates: Partial<Tenant>) {
    const url = window.location.hostname === 'localhost'
      ? `http://localhost:3000/api/orders/info`
      : `${this.apiUrl}/orders/info`;

    return this.http.patch<Tenant>(url, updates, {
      headers: { 'x-tenant-id': id }
    }).subscribe({
      next: (updated) => {
        this.currentTenant.set(updated);
        this.applyBranding(updated);
      },
      error: (err) => console.error('[TenantService] Failed to update tenant:', err)
    });
  }

  private applyBranding(tenant: Tenant) {
    document.documentElement.style.setProperty('--accent-sage', tenant.primary_color);
    document.documentElement.style.setProperty('--accent-terracotta', tenant.secondary_color);
    // You could also update the favicon or site title here
    document.title = tenant.name + ' | Powered by The Daily Dough';
  }
}
