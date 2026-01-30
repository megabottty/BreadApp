import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { TenantService } from './tenant.service';

export interface InventoryItem {
  id?: string;
  tenant_id?: string;
  ingredient_name: string;
  current_stock: number;
  unit: string;
  min_stock_threshold: number;
  last_updated?: string;
}

@Injectable({
  providedIn: 'root'
})
export class InventoryService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);
  private apiUrl = environment.apiUrl + '/orders/inventory';

  inventory = signal<InventoryItem[]>([]);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return new HttpHeaders();
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  loadInventory() {
    const headers = this.headers;
    if (!headers.has('x-tenant-slug')) return;

    this.http.get<InventoryItem[]>(this.apiUrl, { headers }).subscribe({
      next: (items) => this.inventory.set(items),
      error: (err) => console.error('Failed to load inventory:', err)
    });
  }

  updateStock(ingredientName: string, currentStock: number, minThreshold: number = 0) {
    const headers = this.headers;
    return this.http.post<InventoryItem>(this.apiUrl, {
      ingredient_name: ingredientName,
      current_stock: currentStock,
      min_stock_threshold: minThreshold
    }, { headers }).subscribe({
      next: (updatedItem) => {
        this.inventory.update(items => {
          const index = items.findIndex(i => i.ingredient_name === updatedItem.ingredient_name);
          if (index !== -1) {
            items[index] = updatedItem;
            return [...items];
          }
          return [...items, updatedItem];
        });
      },
      error: (err) => console.error('Failed to update inventory:', err)
    });
  }
}
