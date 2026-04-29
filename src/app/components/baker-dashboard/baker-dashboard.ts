import { Component, inject, signal, computed, effect } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import { OrdersManagerComponent } from '../orders-manager/orders-manager';
import { BakeryLedgerComponent } from '../bakery-ledger/bakery-ledger';
import { RecipeCalculatorComponent } from '../recipe-calculator/recipe-calculator';
import { BusinessAnalyticsComponent } from '../business-analytics/business-analytics';
import { PosTerminalComponent } from '../pos-terminal/pos-terminal';
import { TenantService } from '../../services/tenant.service';
import { ModalService } from '../../services/modal.service';
import { InventoryService } from '../../services/inventory.service';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, Order, aggregateOrders, calculateMasterDough } from '../../logic/bakers-math';

@Component({
  selector: 'app-baker-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OrdersManagerComponent,
    BakeryLedgerComponent,
    RecipeCalculatorComponent,
    BusinessAnalyticsComponent,
    PosTerminalComponent
  ],
  templateUrl: './baker-dashboard.html',
  styleUrls: ['./baker-dashboard.css']
})
export class BakerDashboardComponent {
  private tenantService = inject(TenantService);
  protected modalService = inject(ModalService);
  private helpService = inject(HelpService);
  private inventoryService = inject(InventoryService);
  private http = inject(HttpClient);

  ovenCapacityValue = signal<number>(6);

  activeTab = signal<'orders' | 'pos' | 'ledger' | 'recipes' | 'settings' | 'inventory' | 'forecast' | 'billing'>('orders');
  currentTenant = this.tenantService.tenant;

  savedRecipes = signal<CalculatedRecipe[]>([]);
  allOrders = signal<Order[]>([]);
  inventory = this.inventoryService.inventory;
  targetDeliveryTime = signal<string>('08:00');
  supplyPlanItems = signal<SupplyPlanItem[]>([]);
  supplyPlanMeta = signal<SupplyPlanMeta | null>(null);
  supplyPlanLoading = signal<boolean>(false);
  billingSummary = signal<BillingSummary | null>(null);
  billingLoading = signal<boolean>(false);
  pendingSetupSessionId = signal<string | null>(null);

  // Inventory logic
  ingredientNeeds = computed(() => {
    const orders = this.allOrders();
    const recipes = this.savedRecipes();

    // Aggregate for the next 7 days
    const today = new Date();
    const needs: Record<string, number> = {};

    for (let i = 0; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      const dayAgg = aggregateOrders(orders, dateStr);
      const dayMaster = calculateMasterDough(dayAgg, recipes);

      Object.entries(dayMaster).forEach(([ing, data]: [string, any]) => {
        needs[ing] = (needs[ing] || 0) + data.weight;
      });
    }

    return needs;
  });

  inventoryStatus = computed(() => {
    const currentInventory = this.inventory();
    const needs = this.ingredientNeeds();
    const recipes = this.savedRecipes();

    // Collect ALL unique ingredient names from recipes AND current inventory
    const allIngredientNames = new Set<string>();
    recipes.forEach(r => r.ingredients.forEach(ing => allIngredientNames.add(ing.name)));
    currentInventory.forEach(item => allIngredientNames.add(item.ingredient_name));

    return Array.from(allIngredientNames).map(name => {
      const item = currentInventory.find(i => i.ingredient_name === name);
      const stock = item?.current_stock || 0;
      const threshold = item?.min_stock_threshold || 1000; // 1kg default
      const needed = needs[name] || 0;
      const diff = stock - needed;

      return {
        name,
        stock,
        needed,
        diff,
        isLow: stock < threshold || (needed > 0 && diff < 0),
        percentage: Math.min(100, (stock / Math.max(needed, threshold)) * 100)
      };
    });
  });

  private get headers() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return new HttpHeaders();
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  constructor() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment_setup') === 'success') {
      const sessionId = params.get('session_id');
      if (sessionId) {
        this.pendingSetupSessionId.set(sessionId);
      }
    }

    this.loadData();

    // Reload inventory whenever tab changes to it
    effect(() => {
      if (this.activeTab() === 'inventory') {
        this.inventoryService.loadInventory();
        this.loadSupplyPlan();
      }
    });

    // Confirm Stripe setup return when we have both a tenant and session id.
    effect(() => {
      const sessionId = this.pendingSetupSessionId();
      const tenant = this.currentTenant();
      if (!sessionId || !tenant) return;
      this.confirmSetupSession(sessionId, tenant.id, tenant.slug);
    });

    // Load billing data when billing tab is opened.
    effect(() => {
      if (this.activeTab() === 'billing') {
        this.loadBillingSummary();
      }
    });
  }

  loadSupplyPlan() {
    const headers = this.headers;
    if (!headers.has('x-tenant-slug')) return;

    this.supplyPlanLoading.set(true);
    this.http.get<SupplyPlanResponse>(`${environment.apiUrl}/orders/analytics/supply-plan`, { headers }).subscribe({
      next: (response) => {
        this.supplyPlanItems.set(response.items || []);
        this.supplyPlanMeta.set(response.plan || null);
        this.supplyPlanLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load supply plan:', err);
        this.supplyPlanLoading.set(false);
      }
    });
  }

  loadData() {
    const headers = this.headers;
    if (headers.has('x-tenant-slug')) {
      this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe(r => this.savedRecipes.set(r));
      this.http.get<Order[]>(`${environment.apiUrl}/orders`, { headers }).subscribe(o => this.allOrders.set(o));
      this.inventoryService.loadInventory();
      const tenant = this.currentTenant();
      if (tenant) {
        this.ovenCapacityValue.set(tenant.oven_capacity || 6);
      }
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

  showHint(section: string) {
    const hint = this.helpService.getHint(section);
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }

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

  updateStock(name: string) {
    const item = this.inventory().find(i => i.ingredient_name === name);
    const newStock = prompt(`Update current stock for ${name} (grams):`, item?.current_stock?.toString() || '0');
    if (newStock !== null) {
      const stockNum = parseFloat(newStock);
      if (!isNaN(stockNum)) {
        this.inventoryService.updateStock(name, stockNum, item?.min_stock_threshold);
        this.modalService.showAlert(`Stock for ${name} has been updated to ${stockNum}g.`, 'Inventory Updated', 'success');
      }
    }
  }

  addManualIngredient() {
    const name = prompt('Enter the name of the new ingredient:');
    if (name) {
      const stock = prompt(`Enter initial stock for ${name} (grams):`, '0');
      const stockNum = parseFloat(stock || '0');
      if (!isNaN(stockNum)) {
        this.inventoryService.updateStock(name, stockNum, 1000); // 1kg default threshold
        this.modalService.showAlert(`${name} added to inventory!`, 'Success', 'success');
      }
    }
  }

  generatePO() {
    const lowItems = this.inventoryStatus().filter(i => i.isLow);
    if (lowItems.length === 0) {
      this.modalService.showAlert('Your inventory levels are looking good for the next 7 days!', 'No PO Needed', 'info');
      return;
    }

    const poItems = lowItems.map(i => ({
      name: i.name,
      amountNeeded: Math.max(0, i.needed - i.stock) + 5000 // Add a 5kg buffer
    }));

    const supplierEmail = prompt('Enter supplier email address:', 'orders@supplier.com');
    if (!supplierEmail) return;

    this.http.post(`${environment.apiUrl}/orders/generate-po`, {
      poItems,
      supplierEmail
    }, { headers: this.headers }).subscribe({
      next: (res: any) => {
        this.modalService.showAlert(res.message, 'PO Generated & Emailed', 'success');
      },
      error: (err) => {
        console.error('Failed to generate PO:', err);
        this.modalService.showAlert('Failed to send PO email. Please check your SMTP settings.', 'Error', 'error');
      }
    });
  }

  showChangePlanModal = signal(false);
  selectedPlan = signal<string>('');

  plans = [
    { id: 'STARTER', name: 'Starter', price: 29, features: ['Up to 100 orders/month', 'Basic analytics', 'Email support'] },
    { id: 'PROFESSIONAL', name: 'Professional', price: 79, features: ['Up to 500 orders/month', 'Advanced analytics', 'Priority support', 'Inventory management'] },
    { id: 'ENTERPRISE', name: 'Enterprise', price: 199, features: ['Unlimited orders', 'Custom integrations', 'Dedicated account manager', 'Multi-location support'] }
  ];

  openChangePlanModal() {
    this.selectedPlan.set(this.currentTenant()?.subscription_plan || 'STARTER');
    this.showChangePlanModal.set(true);
  }

  closeChangePlanModal() {
    this.showChangePlanModal.set(false);
  }

  changePlan() {
    const newPlan = this.selectedPlan();
    if (!newPlan) return;

    this.modalService.showAlert(
      `Your plan will be changed to ${newPlan} on your next billing cycle. You will be charged accordingly.`,
      'Plan Change Scheduled',
      'success'
    );
    this.showChangePlanModal.set(false);

    // TODO: Call backend to update subscription plan
    // this.http.post(`${environment.apiUrl}/payments/change-plan`, { plan: newPlan }).subscribe(...);
  }

  linkCard() {
    const tenant = this.currentTenant();
    if (!tenant) return;

    // Create a Stripe Checkout session for setting up payment method
    this.http.post<{ url: string }>(`${environment.apiUrl}/payments/create-setup-session`, {
      tenantId: tenant.id,
      email: tenant.email || 'owner@bakery.com'
    }, { headers: this.headers }).subscribe({
      next: (response) => {
        if (response.url) {
          window.location.href = response.url;
        }
      },
      error: (err) => {
        console.error('Failed to create setup session:', err);
        this.modalService.showAlert('Failed to open payment setup. Please try again.', 'Error', 'error');
      }
    });
  }

  openCustomerPortal() {
    const tenant = this.currentTenant();
    if (!tenant || !tenant.stripe_account_id) {
      this.modalService.showAlert('No payment method on file. Please link a card first.', 'No Payment Method', 'info');
      return;
    }

    // Open Stripe Customer Portal for managing payment methods
    this.http.post<{ url: string }>(`${environment.apiUrl}/payments/create-portal-session`, {
      customerId: tenant.stripe_account_id
    }, { headers: this.headers }).subscribe({
      next: (response) => {
        if (response.url) {
          window.open(response.url, '_blank');
        }
      },
      error: (err) => {
        console.error('Failed to open customer portal:', err);
        this.modalService.showAlert('Failed to open payment portal. Please try again.', 'Error', 'error');
      }
    });
  }

  loadBillingSummary() {
    const customerId = this.currentTenant()?.stripe_account_id;
    if (!customerId) {
      this.billingSummary.set(null);
      this.billingLoading.set(false);
      return;
    }

    this.billingLoading.set(true);
    this.http.get<BillingSummary>(`${environment.apiUrl}/payments/billing-summary/${customerId}`, { headers: this.headers }).subscribe({
      next: (summary) => {
        this.billingSummary.set(summary);
        this.billingLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load billing summary:', err);
        this.billingSummary.set(null);
        this.billingLoading.set(false);
      }
    });
  }

  private confirmSetupSession(sessionId: string, tenantId: string, tenantSlug: string) {
    this.http.post<{ customerId: string }>(`${environment.apiUrl}/payments/confirm-setup-session`, {
      sessionId,
      tenantId
    }, { headers: this.headers }).subscribe({
      next: () => {
        this.pendingSetupSessionId.set(null);
        window.history.replaceState({}, '', '/dashboard');
        this.tenantService.loadTenantInfo(tenantSlug);
        this.loadBillingSummary();
        this.modalService.showAlert('Payment method linked successfully.', 'Billing Updated', 'success');
      },
      error: (err) => {
        console.error('Failed to confirm setup session:', err);
        this.pendingSetupSessionId.set(null);
      }
    });
  }

  openInvoice(url: string | null) {
    if (!url) return;
    window.open(url, '_blank');
  }
}

interface SupplyPlanItem {
  ingredient_name: string;
  current_stock: number;
  forecast_need: number;
  reorder_amount: number;
  unit: string;
}

interface SupplyPlanMeta {
  id: string;
  start_date: string;
  end_date: string;
  lead_time_days: number;
  safety_buffer_grams: number;
}

interface SupplyPlanResponse {
  plan: SupplyPlanMeta;
  items: SupplyPlanItem[];
}

interface BillingInvoice {
  id: string;
  amountPaid: number;
  currency: string;
  status: string | null;
  createdAt: string | null;
  invoicePdf: string | null;
  hostedInvoiceUrl: string | null;
}

interface BillingSummary {
  paymentMethod: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  } | null;
  invoices: BillingInvoice[];
  nextBillingDate: string | null;
  subscriptionStatus: string | null;
}
