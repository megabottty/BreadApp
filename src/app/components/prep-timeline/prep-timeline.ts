import { Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CommonModule, DatePipe, CurrencyPipe } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TenantService } from '../../services/tenant.service';
import { ToastService } from '../../services/toast.service';
import { Order, CalculatedRecipe } from '../../logic/bakers-math';

interface PrepScheduleItem {
  order: Order;
  daysUntilReady: number;
  needsStarterPrep: boolean;
  prepDate: Date;
  bakeDate: Date;
  starterAmount: number;
  ingredientBreakdown: {
    totalFlour: number;
    totalWater: number;
    totalSalt: number;
    totalStarter: number;
  };
}

@Component({
  selector: 'app-prep-timeline',
  standalone: true,
  imports: [CommonModule, DatePipe, CurrencyPipe],
  template: `
    <div class="prep-timeline-container">
      <header class="timeline-header">
        <h1>🥖 Prep Timeline & Starter Calculator</h1>
        <p class="subtitle">Stay ahead of your orders with automatic prep notifications</p>
      </header>

      <!-- Urgent Alerts -->
      @if (urgentOrders().length > 0) {
        <div class="urgent-alerts">
          <h2>🔔 Action Required!</h2>
          @for (item of urgentOrders(); track item.order.id) {
            <div class="urgent-card" role="alert">
              <div class="urgent-header">
                <span class="badge urgent">{{ item.daysUntilReady === 0 ? 'BAKE TODAY' : 'PREP STARTER NOW' }}</span>
                <span class="order-id">Order #{{ item.order.id }}</span>
              </div>
              <div class="urgent-details">
                <p><strong>Customer:</strong> {{ item.order.customerName }}</p>
                <p><strong>Ready Date:</strong> {{ item.order.pickupDate | date:'fullDate' }}</p>
                <p><strong>Starter Needed:</strong> {{ item.starterAmount }}g</p>
              </div>
              <div class="ingredient-summary">
                <div class="ing-item">
                  <span class="label">Flour:</span>
                  <span class="value">{{ item.ingredientBreakdown.totalFlour }}g</span>
                </div>
                <div class="ing-item">
                  <span class="label">Water:</span>
                  <span class="value">{{ item.ingredientBreakdown.totalWater }}g</span>
                </div>
                <div class="ing-item">
                  <span class="label">Salt:</span>
                  <span class="value">{{ item.ingredientBreakdown.totalSalt }}g</span>
                </div>
                <div class="ing-item">
                  <span class="label">Starter:</span>
                  <span class="value">{{ item.ingredientBreakdown.totalStarter }}g</span>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Timeline View -->
      <div class="timeline-section">
        <h2>📅 7-Day Production Schedule</h2>

        @for (day of next7Days(); track day.date) {
          <div class="day-card" [class.today]="isToday(day.date)" [class.has-orders]="day.orders.length > 0">
            <div class="day-header">
              <h3>
                {{ day.date | date:'EEEE, MMM d' }}
                @if (isToday(day.date)) {
                  <span class="today-badge">TODAY</span>
                }
              </h3>
              @if (day.orders.length === 0) {
                <span class="no-orders">No orders scheduled</span>
              } @else {
                <span class="order-count">{{ day.orders.length }} order(s)</span>
              }
            </div>

            @if (day.orders.length > 0) {
              <div class="day-orders">
                @for (item of day.orders; track item.order.id) {
                  <div class="order-preview">
                    <div class="order-preview-header">
                      <span class="order-id">#{{ item.order.id }}</span>
                      <span class="customer">{{ item.order.customerName }}</span>
                    </div>
                    <div class="order-items">
                      @for (orderItem of item.order.items; track orderItem.recipeId) {
                        <div class="item-chip">
                          {{ orderItem.quantity }}x {{ orderItem.name }}
                        </div>
                      }
                    </div>
                    <div class="prep-status">
                      @if (item.needsStarterPrep) {
                        <span class="status-badge prep">Feed starter on {{ item.prepDate | date:'shortDate' }}</span>
                      } @else {
                        <span class="status-badge ready">Ready to bake</span>
                      }
                    </div>
                  </div>
                }

                <!-- Daily Starter Total -->
                <div class="day-starter-total">
                  <span class="icon">🍞</span>
                  <span class="label">Total Starter Needed:</span>
                  <span class="amount">{{ day.totals.starter }}g</span>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Ingredient Totals by Day -->
      <div class="daily-totals-section">
        <h2>📊 Daily Ingredient Totals</h2>
        @for (day of next7Days(); track day.date) {
          @if (day.orders.length > 0) {
            <div class="totals-card">
              <h3>{{ day.date | date:'EEEE, MMM d' }}</h3>
              <div class="totals-grid">
                <div class="total-item">
                  <span class="icon">🌾</span>
                  <span class="label">Total Flour</span>
                  <span class="amount">{{ day.totals.flour }}g</span>
                </div>
                <div class="total-item">
                  <span class="icon">💧</span>
                  <span class="label">Total Water</span>
                  <span class="amount">{{ day.totals.water }}g</span>
                </div>
                <div class="total-item">
                  <span class="icon">🧂</span>
                  <span class="label">Total Salt</span>
                  <span class="amount">{{ day.totals.salt }}g</span>
                </div>
                <div class="total-item">
                  <span class="icon">🍞</span>
                  <span class="label">Total Starter</span>
                  <span class="amount">{{ day.totals.starter }}g</span>
                </div>
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .prep-timeline-container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .timeline-header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .timeline-header h1 {
      font-size: 2rem;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 1rem;
    }

    .urgent-alerts {
      background: #FFF3CD;
      border: 2px solid #FFC107;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .urgent-alerts h2 {
      color: #856404;
      margin-top: 0;
      margin-bottom: 1rem;
    }

    .urgent-card {
      background: white;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      border-left: 4px solid #DC3545;
    }

    .urgent-card:last-child {
      margin-bottom: 0;
    }

    .urgent-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .badge {
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: bold;
      text-transform: uppercase;
    }

    .badge.urgent {
      background: #DC3545;
      color: white;
    }

    .order-id {
      font-family: monospace;
      font-weight: bold;
      color: var(--text-muted);
    }

    .urgent-details {
      margin-bottom: 1rem;
      line-height: 1.8;
    }

    .ingredient-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 0.75rem;
      padding: 1rem;
      background: #F8F9FA;
      border-radius: 8px;
    }

    .ing-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .ing-item .label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .ing-item .value {
      font-size: 1.25rem;
      font-weight: bold;
      color: var(--accent-sage);
    }

    .timeline-section {
      margin-bottom: 2rem;
    }

    .timeline-section h2 {
      margin-bottom: 1.5rem;
      color: var(--text-primary);
    }

    .day-card {
      background: white;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
      transition: all 0.2s;
    }

    .day-card.today {
      border-color: var(--accent-sage);
      border-width: 2px;
      box-shadow: 0 4px 12px rgba(125, 143, 105, 0.2);
    }

    .day-card.has-orders {
      background: linear-gradient(to right, rgba(125, 143, 105, 0.05), white);
    }

    .day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border-color);
    }

    .day-header h3 {
      margin: 0;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .today-badge {
      background: var(--accent-sage);
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: bold;
    }

    .order-count {
      background: var(--accent-terracotta);
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 600;
    }

    .no-orders {
      color: var(--text-muted);
      font-style: italic;
      font-size: 0.875rem;
    }

    .day-orders {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .order-preview {
      background: #F8F9FA;
      border-radius: 8px;
      padding: 1rem;
    }

    .order-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .customer {
      font-weight: 600;
      color: var(--text-primary);
    }

    .order-items {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .item-chip {
      background: white;
      padding: 0.25rem 0.75rem;
      border-radius: 16px;
      font-size: 0.875rem;
      border: 1px solid var(--border-color);
    }

    .prep-status {
      margin-top: 0.75rem;
    }

    .status-badge {
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .status-badge.prep {
      background: #FFF3CD;
      color: #856404;
      border: 1px solid #FFE69C;
    }

    .status-badge.ready {
      background: #D4EDDA;
      color: #155724;
      border: 1px solid #C3E6CB;
    }

    .day-starter-total {
      margin-top: 1rem;
      padding: 1rem;
      background: linear-gradient(135deg, #7D8F69 0%, #5F6F52 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: white;
      box-shadow: 0 2px 8px rgba(125, 143, 105, 0.3);
    }

    .day-starter-total .icon {
      font-size: 1.5rem;
    }

    .day-starter-total .label {
      flex: 1;
      font-weight: 600;
      font-size: 0.95rem;
    }

    .day-starter-total .amount {
      font-size: 1.5rem;
      font-weight: bold;
      background: rgba(255, 255, 255, 0.2);
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
    }

    .daily-totals-section {
      margin-top: 3rem;
    }

    .daily-totals-section h2 {
      margin-bottom: 1.5rem;
      color: var(--text-primary);
    }

    .totals-card {
      background: white;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }

    .totals-card h3 {
      margin-top: 0;
      margin-bottom: 1rem;
      color: var(--text-primary);
    }

    .totals-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
    }

    .total-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
      background: #F8F9FA;
      border-radius: 8px;
      text-align: center;
    }

    .total-item .icon {
      font-size: 2rem;
    }

    .total-item .label {
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .total-item .amount {
      font-size: 1.5rem;
      font-weight: bold;
      color: var(--accent-sage);
    }

    @media (max-width: 768px) {
      .prep-timeline-container {
        padding: 1rem;
      }

      .ingredient-summary {
        grid-template-columns: repeat(2, 1fr);
      }

      .totals-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  `]
})
export class PrepTimelineComponent implements OnInit {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);
  private toastService = inject(ToastService);

  allOrders = signal<Order[]>([]);
  savedRecipes = signal<CalculatedRecipe[]>([]);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return new HttpHeaders();
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  constructor() {
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        this.loadOrders();
        this.loadRecipes();
      }
    });
  }

  ngOnInit() {
    this.checkForUrgentNotifications();
  }

  loadOrders() {
    this.http.get<Order[]>(`${environment.apiUrl}/orders`, { headers: this.headers }).subscribe({
      next: (orders) => this.allOrders.set(orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED')),
      error: (err) => console.error('Failed to load orders:', err)
    });
  }

  loadRecipes() {
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers: this.headers }).subscribe({
      next: (recipes) => this.savedRecipes.set(recipes),
      error: (err) => console.error('Failed to load recipes:', err)
    });
  }

  prepSchedule = computed(() => {
    const orders = this.allOrders();
    const recipes = this.savedRecipes();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return orders.map(order => {
      const readyDate = new Date(order.pickupDate || '');
      readyDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.floor((readyDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Calculate prep date (2 days before ready date)
      const prepDate = new Date(readyDate);
      prepDate.setDate(prepDate.getDate() - 2);

      // Calculate bake date (usually 1 day before or same day)
      const bakeDate = new Date(readyDate);
      bakeDate.setDate(bakeDate.getDate() - 1);

      // Calculate ingredient breakdown
      let totalFlour = 0;
      let totalWater = 0;
      let totalSalt = 0;
      let totalStarter = 0;

      order.items.forEach(item => {
        const recipe = recipes.find(r => r.id === item.recipeId || r.name === item.name);
        if (recipe) {
          recipe.ingredients.forEach(ing => {
            if (ing.type === 'FLOUR') totalFlour += ing.weight * item.quantity;
            if (ing.type === 'WATER') totalWater += ing.weight * item.quantity;
            if (ing.type === 'SALT') totalSalt += ing.weight * item.quantity;
            if (ing.type === 'LEVAIN') totalStarter += ing.weight * item.quantity;
          });
        }
      });

      const item: PrepScheduleItem = {
        order,
        daysUntilReady: daysUntil,
        needsStarterPrep: daysUntil <= 2 && daysUntil >= 0,
        prepDate,
        bakeDate,
        starterAmount: Math.ceil(totalStarter * 1.2), // 20% buffer
        ingredientBreakdown: {
          totalFlour: Math.ceil(totalFlour),
          totalWater: Math.ceil(totalWater),
          totalSalt: Math.ceil(totalSalt),
          totalStarter: Math.ceil(totalStarter)
        }
      };

      return item;
    });
  });

  urgentOrders = computed(() => {
    return this.prepSchedule().filter(item => item.daysUntilReady <= 2 && item.daysUntilReady >= 0);
  });

  next7Days = computed(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const schedule = this.prepSchedule();

    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() + i);

      const dayOrders = schedule.filter(item => {
        const readyDate = new Date(item.order.pickupDate || '');
        readyDate.setHours(0, 0, 0, 0);
        return readyDate.getTime() === date.getTime();
      });

      // Calculate daily totals
      const totals = dayOrders.reduce((acc, item) => ({
        flour: acc.flour + item.ingredientBreakdown.totalFlour,
        water: acc.water + item.ingredientBreakdown.totalWater,
        salt: acc.salt + item.ingredientBreakdown.totalSalt,
        starter: acc.starter + item.ingredientBreakdown.totalStarter
      }), { flour: 0, water: 0, salt: 0, starter: 0 });

      return { date, orders: dayOrders, totals };
    });
  });

  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  checkForUrgentNotifications() {
    const urgent = this.urgentOrders();
    if (urgent.length > 0) {
      const count = urgent.length;
      this.toastService.warning(`You have ${count} order${count > 1 ? 's' : ''} requiring prep in the next 2 days!`, 8000);
    }
  }
}
