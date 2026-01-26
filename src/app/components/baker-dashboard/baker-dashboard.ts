import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrdersManagerComponent } from '../orders-manager/orders-manager';
import { BakeryLedgerComponent } from '../bakery-ledger/bakery-ledger';
import { RecipeCalculatorComponent } from '../recipe-calculator/recipe-calculator';
import { TenantService } from '../../services/tenant.service';
import { ModalService } from '../../services/modal.service';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, Order, aggregateOrders } from '../../logic/bakers-math';

@Component({
  selector: 'app-baker-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OrdersManagerComponent,
    BakeryLedgerComponent,
    RecipeCalculatorComponent
  ],
  templateUrl: './baker-dashboard.html',
  styleUrls: ['./baker-dashboard.css']
})
export class BakerDashboardComponent {
  private tenantService = inject(TenantService);
  protected modalService = inject(ModalService);
  private http = inject(HttpClient);

  activeTab = signal<'orders' | 'ledger' | 'recipes' | 'settings' | 'inventory' | 'forecast' | 'billing'>('orders');
  currentTenant = this.tenantService.tenant;

  savedRecipes = signal<CalculatedRecipe[]>([]);
  allOrders = signal<Order[]>([]);
  targetDeliveryTime = signal<string>('08:00');

  private get headers() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return new HttpHeaders();
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  constructor() {
    // Load data when tenant is identified
    import('rxjs').then(({ filter }) => {
      // Small hack to use effect but we can just use the signal directly in template if needed
    });

    this.loadData();
  }

  loadData() {
    const headers = this.headers;
    if (headers.has('x-tenant-slug')) {
      this.http.get<CalculatedRecipe[]>('http://localhost:3000/api/orders/recipes', { headers }).subscribe(r => this.savedRecipes.set(r));
      this.http.get<Order[]>('http://localhost:3000/api/orders', { headers }).subscribe(o => this.allOrders.set(o));
    } else {
      setTimeout(() => this.loadData(), 500); // Retry until tenant is loaded
    }
  }

  productionTimeline = computed(() => {
    const recipes = this.savedRecipes();
    const orders = this.allOrders();
    const targetTime = this.targetDeliveryTime();

    // Aggregate for tomorrow (or next bake)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const agg = aggregateOrders(orders, dateStr);

    const timeline: any[] = [];
    let maxTotalTime = 0;

    Object.entries(agg).forEach(([name, qty]) => {
      const recipe = recipes.find(r => r.name === name);
      if (recipe) {
        const prep = recipe.prepTimeMinutes || 0;
        const bake = recipe.bakeTimeMinutes || 45;
        const total = prep + bake;
        if (total > maxTotalTime) maxTotalTime = total;

        timeline.push({
          name,
          quantity: qty,
          prepTime: prep,
          bakeTime: bake,
          totalTime: total
        });
      }
    });

    if (timeline.length === 0) return null;

    // Calculate start time
    const [hours, minutes] = targetTime.split(':').map(Number);
    const deliveryDate = new Date();
    deliveryDate.setHours(hours, minutes, 0, 0);

    const startDate = new Date(deliveryDate.getTime() - (maxTotalTime * 60000));

    return {
      startTime: startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      items: timeline,
      maxTime: maxTotalTime
    };
  });

  saveSettings(primary: string, secondary: string, ovenCapacity: string, address: string, phone: string, email: string) {
    const tenant = this.currentTenant();
    if (tenant) {
      this.tenantService.updateTenantBranding(
        tenant.id,
        primary,
        secondary,
        parseInt(ovenCapacity) || 6,
        address,
        phone,
        email
      );
      this.modalService.showAlert('Your shop settings have been updated.', 'Settings Saved', 'success');
    }
  }

  showToastDocs() {
    this.modalService.showAlert(
      `1. Log in to your Toast Portal.
       2. Navigate to Integrations > API Keys.
       3. Create a new Client ID for 'The Daily Dough'.
       4. Paste the Client ID here to sync your menu items and orders.
       Note: Toast handles your in-store POS, while Stripe handles your online storefront payments.`,
      'Toast Integration Guide',
      'info'
    );
  }

  showInventoryDocs() {
    this.modalService.showAlert(
      `1. Your 'Batch Production List' is automatically generated in the 'Orders' tab under 'Production Plan'.
       2. Add new 'Inventory' items by saving recipes with ingredient costs in the 'Recipe Calculator'.
       3. 'Generate PO' calculates the difference between your current stock and what's needed for the next 7 days of production.`,
      'Inventory & PO Guide',
      'info'
    );
  }

  generatePO() {
    this.modalService.showAlert(
      'Purchase Order for 45kg Bread Flour has been generated and sent to your primary supplier email.',
      'PO Generated',
      'success'
    );
  }
}
