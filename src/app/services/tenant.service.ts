import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
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
  subscription_status?: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  subscription_plan?: 'BASIC' | 'PRO' | 'ENTERPRISE';
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

    // Path-based logic: /b/slug/...
    if (path.startsWith('/b/')) {
      const parts = path.split('/');
      if (parts[2]) {
        slug = parts[2];
      }
    } else if (host !== 'localhost' && !host.includes('bluehost.com') && !host.includes('thedailydough.store')) {
      // Subdomain logic: slug.daily-dough.com
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

    // Clean slug from any trailing slashes or junk
    slug = slug.replace(/\/$/, '').trim();

    this.loadTenantInfo(slug);
  }

  loadTenantInfo(slug: string) {
    if (!slug) {
      console.warn('[TenantService] No slug provided to loadTenantInfo');
      return;
    }
    console.log(`[TenantService] Loading info for slug: ${slug}`);
    this.http.get<Tenant>(`${this.apiUrl}/orders/info`, {
      headers: { 'x-tenant-slug': slug }
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
          // No warning needed for the default tenant if not found, it might be the first run
          if (slug !== 'thedailydough') {
            console.warn(`[TenantService] Bakery not found for slug: ${slug}. This usually means the bakery hasn't been registered yet.`);
          }
        } else {
          console.error(`[TenantService] Failed to load tenant info for slug: ${slug}`, err);
        }
      }
    });
  }

  registerBakery(name: string, slug: string) {
    return this.http.post<Tenant>(`${this.apiUrl}/orders/register-bakery`, { name, slug });
  }

  updateTenantBranding(id: string, primary: string, secondary: string, oven_capacity: number = 6, address?: string, phone?: string, email?: string) {
    return this.updateTenant(id, {
      primary_color: primary,
      secondary_color: secondary,
      oven_capacity: oven_capacity,
      address: address,
      phone: phone,
      email: email
    });
  }

  updateTenant(id: string, updates: Partial<Tenant>) {
    return this.http.patch<Tenant>(`${this.apiUrl}/orders/info`, updates, {
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
