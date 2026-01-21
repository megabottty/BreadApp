import { Component, OnInit, signal, computed, inject, effect } from '@angular/core';
import { CommonModule, DecimalPipe, DatePipe, KeyValuePipe } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
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
  selectedOrder = signal<Order | null>(null);
  bakerNotes = signal<string>('');

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
    this.http.get<CalculatedRecipe[]>('http://localhost:3000/api/orders/recipes', { headers }).subscribe({
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
    this.http.get<Order[]>('http://localhost:3000/api/orders', { headers }).subscribe({
      next: (orders) => this.allOrders.set(orders),
      error: (err) => console.error('Failed to load orders:', err)
    });
  }

  updateOrderStatus(orderId: string, status: Order['status']): void {
    this.http.patch(`http://localhost:3000/api/orders/${orderId}/status`, { status }).subscribe({
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
    this.http.patch(`http://localhost:3000/api/orders/${order.id}/notes`, { notes: this.bakerNotes() }).subscribe({
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
}
