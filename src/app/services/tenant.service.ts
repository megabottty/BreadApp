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
}

@Injectable({
  providedIn: 'root'
})
export class TenantService {
  private http = inject(HttpClient);

  private currentTenant = signal<Tenant | null>(null);
  tenant = computed(() => this.currentTenant());

  constructor() {
    this.identifyTenant();
  }

  private identifyTenant() {
    // Logic to identify tenant from URL
    // e.g. baker1.daily-dough.com or daily-dough.com/baker1
    const host = window.location.hostname;
    const path = window.location.pathname;

    let slug = 'the-daily-dough'; // Default for demo

    // Simple path-based logic for now: /b/slug/...
    if (path.startsWith('/b/')) {
      slug = path.split('/')[2];
    } else if (host !== 'localhost' && host.includes('.')) {
      // Subdomain logic: slug.daily-dough.com
      slug = host.split('.')[0];
    }

    this.loadTenantInfo(slug);
  }

  loadTenantInfo(slug: string) {
    console.log(`[TenantService] Loading info for slug: ${slug}`);
    this.http.get<Tenant>(`http://localhost:3000/api/orders/info`, {
      headers: { 'x-tenant-slug': slug }
    }).subscribe({
      next: (tenant) => {
        console.log(`[TenantService] Tenant info loaded:`, tenant);
        this.currentTenant.set(tenant);
        this.applyBranding(tenant);
      },
      error: (err) => {
        console.error(`[TenantService] Failed to load tenant info for slug: ${slug}`, err);
        if (err.status === 404) {
          console.warn('[TenantService] This usually means the bakery slug hasn\'t been registered yet.');
        }
      }
    });
  }

  registerBakery(name: string, slug: string) {
    return this.http.post<Tenant>(`http://localhost:3000/api/orders/register-bakery`, { name, slug });
  }

  updateTenantBranding(id: string, primary: string, secondary: string) {
    return this.http.patch<Tenant>(`http://localhost:3000/api/orders/info`, { primary_color: primary, secondary_color: secondary }, {
      headers: { 'x-tenant-id': id }
    }).subscribe({
      next: (updated) => {
        this.currentTenant.set(updated);
        this.applyBranding(updated);
      }
    });
  }

  private applyBranding(tenant: Tenant) {
    document.documentElement.style.setProperty('--accent-sage', tenant.primary_color);
    document.documentElement.style.setProperty('--accent-terracotta', tenant.secondary_color);
    // You could also update the favicon or site title here
    document.title = tenant.name + ' | Powered by The Daily Dough';
  }
}
