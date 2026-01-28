import { Component, OnInit, signal, computed, inject, effect } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe, KeyValuePipe } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { Order, CalculatedRecipe, aggregateOrders, calculateMasterDough } from '../../logic/bakers-math';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';
import { SubscriptionService } from '../../services/subscription.service';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-orders-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, DecimalPipe, DatePipe, KeyValuePipe],
  templateUrl: './orders-manager.html',
  styleUrls: ['./orders-manager.css']
})
export class OrdersManagerComponent implements OnInit {
  protected notificationService = inject(NotificationService);
  protected authService = inject(AuthService);
  private http = inject(HttpClient);
  private subscriptionService = inject(SubscriptionService);
  private modalService = inject(ModalService);

  bakeDate = signal<string>(new Date().toISOString().split('T')[0]);
  allOrders = signal<Order[]>([]);
  savedRecipes = signal<CalculatedRecipe[]>([]);
  showNotifications = signal<boolean>(false);
  showManualOrderModal = signal<boolean>(false);
  selectedOrder = signal<Order | null>(null);
  bakerNotes = signal<string>('');
  rightTab = signal<'ingredients' | 'batches'>('ingredients');

  productionBatches = computed(() => {
    const agg = this.aggregatedOrders();
    const subs = this.subscriptionOrders();
    const totalAgg = { ...agg };
    Object.entries(subs).forEach(([name, qty]) => {
      totalAgg[name] = (totalAgg[name] || 0) + qty;
    });

    if (Object.keys(totalAgg).length === 0) return [];

    // Simple heuristic for batches: Group by category and max capacity per batch
    const capacity = this.tenantService.tenant()?.oven_capacity || 6;
    const defaultTemp = this.tenantService.tenant()?.default_bake_temp || 450;
    const defaultSteam = this.tenantService.tenant()?.default_steam_time || 15;
    const defaultTime = this.tenantService.tenant()?.default_bake_time || '45m';

    const batches: any[] = [];
    let currentBatch: any[] = [];
    let countInBatch = 0;

    Object.entries(totalAgg).forEach(([name, qty]) => {
      for (let i = 0; i < qty; i++) {
        if (countInBatch >= capacity) {
          batches.push({
            items: this.summarizeItems(currentBatch),
            temp: defaultTemp,
            steamMinutes: defaultSteam,
            estimatedTime: defaultTime
          });
          currentBatch = [];
          countInBatch = 0;
        }
        currentBatch.push(name);
        countInBatch++;
      }
    });

    if (currentBatch.length > 0) {
      batches.push({
        items: this.summarizeItems(currentBatch),
        temp: defaultTemp,
        steamMinutes: defaultSteam,
        estimatedTime: defaultTime
      });
    }

    return batches;
  });

  private summarizeItems(items: string[]) {
    const summary: Record<string, number> = {};
    items.forEach(name => summary[name] = (summary[name] || 0) + 1);
    return Object.entries(summary).map(([name, quantity]) => ({ name, quantity }));
  }

  // Manual Order Form State
  manualOrder = signal<Partial<Order>>({
    customerName: '',
    customerPhone: '',
    type: 'PICKUP',
    orderSource: 'PHONE',
    status: 'PENDING',
    items: [],
    notes: ''
  });
  manualOrderItem = signal<{ recipeId: string, quantity: number }>({ recipeId: '', quantity: 1 });

  aggregatedOrders = computed(() => {
    return aggregateOrders(this.allOrders(), this.bakeDate());
  });

  subscriptionOrders = computed(() => {
    const subs = this.subscriptionService.allSubscriptions().filter(s =>
      s.status === 'ACTIVE' && s.nextBakeDate === this.bakeDate()
    );
    const agg: Record<string, number> = {};
    subs.forEach(s => {
      agg[s.recipeName] = (agg[s.recipeName] || 0) + s.quantity;
    });
    return agg;
  });

  // Detailed Breakdown per Loaf Type
  loafBreakdown = computed(() => {
    const ordersAgg = this.aggregatedOrders();
    const subsAgg = this.subscriptionOrders();
    const recipes = this.savedRecipes();

    // Merge aggregations
    const totalAgg = { ...ordersAgg };
    Object.entries(subsAgg).forEach(([name, qty]) => {
      totalAgg[name] = (totalAgg[name] || 0) + qty;
    });

    const breakdown: Record<string, { quantity: number, ingredients: any[] }> = {};

    Object.entries(totalAgg).forEach(([recipeName, quantity]) => {
      const recipe = recipes.find(r => r.name === recipeName);
      if (recipe) {
        breakdown[recipeName] = {
          quantity,
          ingredients: recipe.ingredients.map(ing => ({
            name: ing.name,
            totalWeight: ing.weight * quantity
          }))
        };
      }
    });

    return breakdown;
  });

  masterDough = computed(() => {
    const ordersAgg = this.aggregatedOrders();
    const subsAgg = this.subscriptionOrders();

    const totalAgg = { ...ordersAgg };
    Object.entries(subsAgg).forEach(([name, qty]) => {
      totalAgg[name] = (totalAgg[name] || 0) + qty;
    });

    return calculateMasterDough(totalAgg, this.savedRecipes());
  });

  filteredOrders = computed(() => {
    return this.allOrders().filter(o => {
      const orderDate = o.pickupDate ? o.pickupDate.split('T')[0] : (o.createdAt ? o.createdAt.split('T')[0] : null);
      const normalizedOrderDate = orderDate ? orderDate.split(' ')[0] : null;
      return normalizedOrderDate === this.bakeDate();
    });
  });

  statusSummary = computed(() => {
    const orders = this.filteredOrders();
    return {
      pending: orders.filter(o => o.status === 'PENDING').length,
      ready: orders.filter(o => o.status === 'READY' || o.status === 'SHIPPED').length,
      completed: orders.filter(o => o.status === 'COMPLETED').length,
      total: orders.length
    };
  });

  constructor() {
    // React to tenant changes to reload data
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        console.log('[OrdersManager] Tenant identified, loading orders and recipes:', tenant.slug);
        this.loadRealOrders();
        this.loadSavedRecipes();
      }
    });
  }

  ngOnInit(): void {
  }

  private tenantService = inject(TenantService);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return new HttpHeaders();
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  loadSavedRecipes(): void {
    const headers = this.headers;
    if (!headers.has('x-tenant-slug')) {
      console.warn('[OrdersManager] Skipping loadSavedRecipes: No tenant slug identified yet.');
      return;
    }
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes) => this.savedRecipes.set(recipes),
      error: (err) => console.error('Error loading recipes', err)
    });
  }

  loadRealOrders(): void {
    const headers = this.headers;
    if (!headers.has('x-tenant-slug')) {
      console.warn('[OrdersManager] Skipping loadRealOrders: No tenant slug identified yet.');
      return;
    }
    this.http.get<Order[]>(`${environment.apiUrl}/orders`, { headers }).subscribe({
      next: (orders) => this.allOrders.set(orders),
      error: (err) => console.error('Failed to load orders:', err)
    });
  }

  updateOrderStatus(orderId: string, status: Order['status']): void {
    this.http.patch(`${environment.apiUrl}/orders/${orderId}/status`, { status }).subscribe({
      next: () => {
        this.allOrders.update(orders =>
          orders.map(o => o.id === orderId ? { ...o, status } : o)
        );
        const order = this.allOrders().find(o => o.id === orderId);
        if (order) this.triggerNotification(order);
      }
    });
  }

  private triggerNotification(order: Order): void {
    if (order.status === 'READY' && order.type === 'PICKUP') {
      this.notificationService.sendReadyForPickup(order.customerName, order.customerPhone);
    } else if (order.status === 'SHIPPED' && order.type === 'SHIPPING') {
      this.notificationService.sendOutForDelivery(order.customerName, order.customerPhone, 'https://daily-dough.com/track/' + order.id);
    }
  }

  openOrderDetails(order: Order) {
    this.selectedOrder.set(order);
    this.bakerNotes.set(order.notes || '');
  }

  closeOrderDetails() {
    this.selectedOrder.set(null);
  }

  saveBakerNotes() {
    const order = this.selectedOrder();
    if (!order) return;
    this.http.patch(`${environment.apiUrl}/orders/${order.id}/notes`, { notes: this.bakerNotes() }).subscribe({
      next: () => {
        this.allOrders.update(orders =>
          orders.map(o => o.id === order.id ? { ...o, notes: this.bakerNotes() } : o)
        );
        this.modalService.showAlert('Notes updated! 📝', 'Success', 'success');
      }
    });
  }

  contactCustomer(order: Order) {
    const message = prompt(`Enter message for ${order.customerName}:`, `Hi ${order.customerName}, about your order #${order.id}...`);
    if (message) {
      this.notificationService.sendSMS(order.customerPhone, message);
      this.modalService.showAlert('Message sent! 📲', 'SMS Sent', 'success');
    }
  }

  getRecipeCategory(recipeName: string): string {
    const recipe = this.savedRecipes().find(r => r.name === recipeName);
    return recipe?.category || 'BREAD';
  }

  getOrderWeight(order: Order): number {
    return order.items.reduce((sum, item) => sum + (item.weightGrams || 0), 0);
  }

  getItemIngredients(itemName: string, quantity: number) {
    const recipe = this.savedRecipes().find(r => r.name === itemName);
    if (!recipe) return [];
    return recipe.ingredients.map(ing => ({
      name: ing.name,
      weight: ing.weight * quantity
    }));
  }

  // Manual Order Methods
  openManualOrder() {
    this.manualOrder.set({
      customerName: '',
      customerPhone: '',
      type: 'PICKUP',
      status: 'PENDING',
      items: [],
      notes: '',
      pickupDate: this.bakeDate()
    });
    this.showManualOrderModal.set(true);
  }

  addManualItem() {
    const item = this.manualOrderItem();
    if (!item.recipeId) return;

    const recipe = this.savedRecipes().find(r => r.id === item.recipeId);
    if (!recipe) return;

    const items = this.manualOrder().items || [];
    items.push({
      recipeId: recipe.id || '',
      name: recipe.name,
      quantity: item.quantity,
      weightGrams: (recipe.ingredients.reduce((sum, ing) => sum + ing.weight, 0)) * item.quantity
    });

    this.manualOrder.update(prev => ({ ...prev, items }));
    this.manualOrderItem.set({ recipeId: '', quantity: 1 });
  }

  removeManualItem(index: number) {
    const items = this.manualOrder().items || [];
    items.splice(index, 1);
    this.manualOrder.update(prev => ({ ...prev, items }));
  }

  saveManualOrder() {
    const order = this.manualOrder();
    if (!order.customerName || !order.items || order.items.length === 0) {
      this.modalService.showAlert('Please enter customer name and at least one item.', 'Missing Info', 'warning');
      return;
    }

    const orderId = 'M-' + Math.random().toString(36).substring(7).toUpperCase();
    const totalPrice = (order.items || []).reduce((sum, item) => {
      const recipe = this.savedRecipes().find(r => r.id === item.recipeId);
      return sum + (recipe?.price || 0) * item.quantity;
    }, 0);

    const finalOrder: Order = {
      id: orderId,
      customerId: 'manual',
      customerName: order.customerName || '',
      customerPhone: order.customerPhone || '',
      type: order.type as 'PICKUP' | 'SHIPPING',
      status: 'PENDING',
      pickupDate: order.pickupDate || this.bakeDate(),
      items: order.items as any[],
      notes: order.notes,
      totalPrice: totalPrice,
      shippingCost: 0,
      createdAt: new Date().toISOString()
    };

    this.http.post(`${environment.apiUrl}/orders`, finalOrder, { headers: this.headers }).subscribe({
      next: () => {
        this.allOrders.update(prev => [finalOrder, ...prev]);
        this.showManualOrderModal.set(false);
        this.modalService.showAlert('Manual order saved! 🥖', 'Success', 'success');
      },
      error: (err) => {
        console.error('Failed to save manual order:', err);
        this.modalService.showAlert('Failed to save order to cloud.', 'Error', 'error');
      }
    });
  }
}
