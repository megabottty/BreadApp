import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, Order, PromoCode } from '../logic/bakers-math';
import { SubscriptionService } from './subscription.service';
import { AuthService } from './auth.service';
import { ModalService } from './modal.service';
import { TenantService } from './tenant.service';

export type FulfillmentType = 'PICKUP' | 'SHIPPING';

export interface CartItem {
  product: CalculatedRecipe;
  quantity: number;
  isSubscription?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private http = inject(HttpClient);
  private modalService = inject(ModalService);
  private cartItems = signal<CartItem[]>([]);
  private isInitialLoad = true;
  // Use localhost for local development, or your live URL for production
  private apiUrl = 'http://localhost:3000/api/orders';
  private paymentUrl = 'http://localhost:3000/api/payments';
  private recipeUrl = 'http://localhost:3000/api/orders/recipes';
  private promoUrl = 'http://localhost:3000/api/orders/promos';

  private availablePromos = signal<PromoCode[]>([]);

  private tenantService = inject(TenantService);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  getOrderById(orderId: string) {
    return this.http.get<Order>(`${this.apiUrl}/${orderId}`, { headers: this.headers });
  }

  fulfillmentType = signal<FulfillmentType>('PICKUP');
  zipCode = signal<string>('');
  notes = signal<string>('');

  appliedPromo = signal<PromoCode | null>(null);

  // Perks / Loyalty
  totalLoavesPurchased = signal<number>(0);
  discountClaimed = signal<boolean>(false);

  // Selectors
  items = computed(() => this.cartItems());

  totalCount = computed(() =>
    this.cartItems().reduce((acc, item) => acc + item.quantity, 0)
  );

  promoDiscount = computed(() => {
    const promo = this.appliedPromo();
    if (!promo) return 0;

    const subtotal = this.cartItems().reduce((acc, item) => acc + (item.quantity * (item.product.price || 12)), 0);

    if (promo.type === 'FIXED') {
      return promo.value;
    } else if (promo.type === 'PERCENT') {
      return subtotal * (promo.value / 100);
    } else if (promo.type === 'FREE_LOAF') {
      // Subtract the price of one loaf (assumed standard price or cheapest loaf in cart)
      if (this.cartItems().length === 0) return 0;
      const prices = this.cartItems().map(i => i.product.price || 12);
      return Math.max(...prices);
    }
    return 0;
  });

  loyaltyDiscount = computed(() => {
    // If a promo is already applied, we might want to disable automatic loyalty discounts
    // to prevent double dipping, or let them stack. Let's let them stack for now if they are different.

    // Every 10 loaves gets $8 off
    const eligibleCount = Math.floor((this.totalLoavesPurchased() + this.totalCount()) / 10);
    const alreadyClaimed = Math.floor(this.totalLoavesPurchased() / 10);
    const newDiscounts = eligibleCount - alreadyClaimed;

    return newDiscounts > 0 ? 8 : 0;
  });

  totalWeight = computed(() =>
    this.cartItems().reduce((acc, item) => {
      const unitWeight = item.product.ingredients.reduce((sum, ing) => sum + ing.weight, 0);
      return acc + (unitWeight * item.quantity);
    }, 0)
  );

  shippingCost = computed(() => {
    if (this.fulfillmentType() === 'PICKUP') return 0;
    if (!this.zipCode()) return 0;

    // Mock Shipping Calculator logic (e.g., $5 base + $2 per kg)
    const weightKg = this.totalWeight() / 1000;
    return 5 + (weightKg * 2);
  });

  totalPrice = computed(() => {
    const itemsTotal = this.cartItems().reduce((acc, item) => acc + (item.quantity * (item.product.price || 12)), 0);
    const total = itemsTotal + this.shippingCost() - this.loyaltyDiscount() - this.promoDiscount();
    return Math.max(0, total);
  });

  private subscriptionService = inject(SubscriptionService);
  private authService = inject(AuthService);

  constructor() {
    this.loadCart();
    this.loadLoyalty();
    this.loadPromos();
    this.isInitialLoad = false;

    // Automatically save cart whenever any relevant signal changes
    effect(() => {
      this.saveCart();
    });
  }

  loadPromos() {
    this.http.get<any[]>(`${this.apiUrl}/promos/all`, { headers: this.headers }).subscribe({
      next: (data) => {
        const mapped: PromoCode[] = data.map(p => ({
          id: p.id,
          code: p.code,
          type: p.type,
          value: p.value,
          description: p.description,
          isActive: p.is_active
        }));
        this.availablePromos.set(mapped);
      },
      error: (err) => {
        if (err.status !== 404) {
          console.error('Failed to load promos', err);
        } else {
          console.warn('[CartService] No promos found for this bakery (404).');
        }
      }
    });
  }

  applyPromoCode(code: string): boolean {
    const normalized = code.toUpperCase().trim();

    const match = this.availablePromos().find(p => p.code === normalized && p.isActive !== false);
    if (match) {
      this.appliedPromo.set(match);
      return true;
    }

    // Fallback/Legacy codes for loyalty if not in DB yet
    const fallbackPromos: PromoCode[] = [
      { code: 'BREADFRIEND', type: 'FIXED', value: 5, description: '$5 Off for Friends' },
      { code: 'FREELOAF', type: 'FREE_LOAF', value: 0, description: 'One Free Loaf' },
      { code: 'DOUGH8', type: 'FIXED', value: 8, description: 'Bread Addict Reward' }
    ];

    const fallbackMatch = fallbackPromos.find(p => p.code === normalized);
    if (fallbackMatch) {
      this.appliedPromo.set(fallbackMatch);
      return true;
    }

    return false;
  }

  removePromo() {
    this.appliedPromo.set(null);
  }

  saveOrderToDatabase(order: Order) {
    return this.http.post(this.apiUrl, order, { headers: this.headers });
  }

  createCheckoutSession(items: CartItem[], customerEmail: string, orderId: string) {
    const payload = {
      items: items.map(item => ({
        name: item.product.name,
        quantity: item.quantity,
        product: { price: item.product.price }
      })),
      customerEmail,
      orderId
    };
    return this.http.post<{ id: string, url: string }>(`${this.paymentUrl}/create-checkout-session`, payload);
  }

  private loadLoyalty() {
    const saved = localStorage.getItem('bakery_loyalty');
    if (saved) {
      this.totalLoavesPurchased.set(parseInt(saved, 10) || 0);
    }
  }

  saveLoyalty(count: number) {
    this.totalLoavesPurchased.set(count);
    localStorage.setItem('bakery_loyalty', count.toString());
  }

  private loadCart() {
    const saved = localStorage.getItem('bakery_cart');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        this.cartItems.set(data.items || []);
        this.fulfillmentType.set(data.fulfillmentType || 'PICKUP');
        this.zipCode.set(data.zipCode || '');
        this.notes.set(data.notes || '');
      } catch (e) {
        console.error('Error loading cart', e);
      }
    }
  }

  private saveCart() {
    if (this.isInitialLoad) return;
    const data = {
      items: this.cartItems(),
      fulfillmentType: this.fulfillmentType(),
      zipCode: this.zipCode(),
      notes: this.notes()
    };
    localStorage.setItem('bakery_cart', JSON.stringify(data));
  }

  addToCart(product: CalculatedRecipe) {
    this.cartItems.update(prev => {
      // Use name as fallback if ID is missing (newly created local recipes)
      const existing = prev.find(item => (item.product.id && item.product.id === product.id) || item.product.name === product.name);
      let updated: CartItem[];
      if (existing) {
        updated = prev.map(item =>
          ((item.product.id && item.product.id === product.id) || item.product.name === product.name)
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        updated = [...prev, { product, quantity: 1 }];
      }
      return updated;
    });
  }

  removeFromCart(productId: string) {
    this.cartItems.update(prev => prev.filter(item => item.product.id !== productId));
  }

  updateQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      this.removeFromCart(productId);
      return;
    }
    this.cartItems.update(prev =>
      prev.map(item =>
        item.product.id === productId ? { ...item, quantity } : item
      )
    );
  }

  toggleSubscription(productId: string) {
    this.cartItems.update(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, isSubscription: !item.isSubscription }
          : item
      )
    );
  }

  setFulfillment(type: FulfillmentType) {
    this.fulfillmentType.set(type);
  }

  setZipCode(zip: string) {
    this.zipCode.set(zip);
  }

  setNotes(notes: string) {
    this.notes.set(notes);
  }

  clearCart() {
    // Process subscriptions before clearing
    const user = this.authService.user();
    if (user) {
      this.cartItems().forEach(item => {
        if (item.isSubscription) {
          this.subscriptionService.createSubscription(user.id, item.product, item.quantity);
        }
      });
    }

    this.cartItems.set([]);
    this.notes.set('');
    this.appliedPromo.set(null);
    this.saveCart();
  }
}
