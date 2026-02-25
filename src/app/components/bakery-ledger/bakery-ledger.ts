import { Component, OnInit, signal, computed, inject, effect } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Order, PromoCode, CalculatedRecipe, calculateBakersMath } from '../../logic/bakers-math';
import { FormsModule } from '@angular/forms';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-bakery-ledger',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
  templateUrl: './bakery-ledger.html',
  styleUrls: ['./bakery-ledger.css']
})
export class BakeryLedgerComponent implements OnInit {
  private http = inject(HttpClient);
  private modalService = inject(ModalService);
  private helpService = inject(HelpService);

  allOrders = signal<Order[]>([]);
  savedRecipes = signal<CalculatedRecipe[]>([]);
  searchTerm = signal<string>('');
  statusFilter = signal<string>('ALL');

  // Promo management
  availablePromos = signal<PromoCode[]>([]);
  showPromoManager = signal(false);

  // New promo form
  newPromo = signal<Partial<PromoCode>>({
    code: '',
    type: 'FIXED',
    value: 5,
    description: '',
    isActive: true
  });

  // Statistics
  stats = computed(() => {
    const orders = this.allOrders();
    const recipes = this.savedRecipes();

    const completedOrders = orders.filter(o => o.status === 'COMPLETED');

    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const pendingRevenue = orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED')
                                 .reduce((sum, o) => sum + (o.totalPrice || 0), 0);

    // Calculate total cost and profit
    let totalCost = 0;
    completedOrders.forEach(o => {
      o.items.forEach(item => {
        // Try to find recipe by ID first, then by name as fallback
        const recipe = recipes.find(r => r.id === item.recipeId) ||
                       recipes.find(r => r.name === item.name);

        if (recipe) {
          totalCost += (Number(recipe.totalCost) || 0) * (Number(item.quantity) || 1);
        }
      });
    });

    const totalProfit = totalRevenue - totalCost;
    const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
      totalOrders: orders.length,
      completedCount: completedOrders.length,
      totalRevenue,
      pendingRevenue,
      totalCost,
      totalProfit,
      profitMargin,
      averageOrderValue: completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0
    };
  });

  filteredOrders = computed(() => {
    let orders = this.allOrders();
    const search = this.searchTerm().toLowerCase();
    const status = this.statusFilter();

    if (status !== 'ALL') {
      orders = orders.filter(o => o.status === status);
    }

    if (search) {
      orders = orders.filter(o =>
        o.customerName.toLowerCase().includes(search) ||
        o.id.toLowerCase().includes(search)
      );
    }

    return orders;
  });

  private tenantService = inject(TenantService);

  private headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  constructor() {
    // React to tenant changes to reload data
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        console.log('[BakeryLedger] Tenant identified, loading orders and promos:', tenant.slug);
        this.loadOrders();
        this.loadPromos();
        this.loadSavedRecipes();
      }
    });
  }

  ngOnInit() {
  }

  loadSavedRecipes(): void {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return;
    const headers = new HttpHeaders().set('x-tenant-slug', slug);
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes) => {
        // Ensure all recipes are fully calculated with costs
        const fullyCalculated = recipes.map(r => {
          try {
            return calculateBakersMath(r);
          } catch (e) {
            console.error('Error re-calculating recipe for ledger:', r.name, e);
            return r;
          }
        });
        this.savedRecipes.set(fullyCalculated);
      },
      error: (err) => console.error('Error loading recipes for ledger', err)
    });
  }

  loadOrders() {
    this.http.get<Order[]>(`${environment.apiUrl}/orders`, { headers: this.headers() }).subscribe({
      next: (orders) => this.allOrders.set(orders),
      error: (err) => console.error('Failed to load ledger orders:', err)
    });
  }

  loadPromos() {
    this.http.get<any[]>(`${environment.apiUrl}/orders/promos/all`, { headers: this.headers() }).subscribe({
      next: (data) => {
        const mapped: PromoCode[] = data.map(p => ({
          id: p.id,
          code: p.code,
          type: p.type,
          value: p.value,
          description: p.description,
          isActive: p.is_active,
          usageCount: this.allOrders().filter(o => o.promoCode === p.code).length
        }));
        this.availablePromos.set(mapped);
      },
      error: (err) => console.error('Failed to load promos', err)
    });
  }

  savePromo() {
    const promo = this.newPromo();
    if (!promo.code) return;

    this.http.post(`${environment.apiUrl}/orders/promos`, promo, { headers: this.headers() }).subscribe({
      next: () => {
        this.loadPromos();
        this.newPromo.set({ code: '', type: 'FIXED', value: 5, description: '', isActive: true });
        this.modalService.showAlert('Promo code saved! 🎟️', 'Success', 'success');
      }
    });
  }

  deletePromo(id: string) {
    if (confirm('Are you sure you want to delete this promo code?')) {
      this.http.delete(`${environment.apiUrl}/orders/promos/${id}`, { headers: this.headers() }).subscribe({
        next: () => this.loadPromos()
      });
    }
  }

  getStatusClass(status: string): string {
    return `status-badge ${status.toLowerCase()}`;
  }

  showHint() {
    const hint = this.helpService.getHint('ledger');
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }
}
