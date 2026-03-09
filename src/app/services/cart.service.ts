import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, Order, PromoCode } from '../logic/bakers-math';
import { SubscriptionService } from './subscription.service';
import { AuthService } from './auth.service';
import { ModalService } from './modal.service';
import { TenantService } from './tenant.service';

import { environment } from '../../environments/environment';

export type FulfillmentType = 'PICKUP' | 'SHIPPING';

export interface CartItem {
  product: CalculatedRecipe;
  quantity: number;
  isSubscription?: boolean;
  notes?: string;
  selectedOptions?: { name: string; price: number }[];
  packOption?: PackOption;
}

export interface PackOption {
  id: string;
  label: string;
  size: number;
  price: number;
}

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private http = inject(HttpClient);
  private modalService = inject(ModalService);
  private cartItems = signal<CartItem[]>([]);
  private isInitialLoad = true;
  private apiUrl = environment.apiUrl + '/orders';
  private paymentUrl = environment.apiUrl + '/payments';
  private recipeUrl = environment.apiUrl + '/orders/recipes';
  private promoUrl = environment.apiUrl + '/orders/promos';

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
  totalOrders = signal<number>(0);
  qualifyingOrders = signal<number>(0);
  discountClaimed = signal<boolean>(false);

  // Selectors
  items = computed(() => this.cartItems().map(item => ({
    ...item,
    selectedOptionsPrice: (item.selectedOptions || []).reduce((sum, opt) => sum + opt.price, 0)
  })));

  totalCount = computed(() =>
    this.cartItems().reduce((acc, item) => acc + (item.quantity * this.getPackSize(item)), 0)
  );

  promoDiscount = computed(() => {
    const promo = this.appliedPromo();
    if (!promo) return 0;

    const subtotal = this.cartItems().reduce((acc, item) => acc + (item.quantity * this.getItemUnitPrice(item)), 0);

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
    const qualifiesForLoaves = this.totalLoavesPurchased() >= 10;
    const qualifiesForOrders = this.totalOrders() >= 10 && this.qualifyingOrders() >= 10;
    if (qualifiesForLoaves || qualifiesForOrders) {
      return 8;
    }
    return 0;
  });

  totalWeight = computed(() =>
    this.cartItems().reduce((acc, item) => {
      const unitWeight = item.product.ingredients.reduce((sum, ing) => sum + ing.weight, 0);
      return acc + (unitWeight * item.quantity * this.getPackSize(item));
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
    const itemsTotal = this.cartItems().reduce((acc, item) => {
      const optionsPrice = (item.selectedOptions || []).reduce((sum, opt) => sum + opt.price, 0);
      return acc + (item.quantity * (this.getItemUnitPrice(item) + optionsPrice));
    }, 0);
    const total = itemsTotal + this.shippingCost() - this.promoDiscount() - this.loyaltyDiscount();
    return Math.max(0, total);
  });

  private subscriptionService = inject(SubscriptionService);
  private authService = inject(AuthService);

  constructor() {
    this.loadCart();
    this.loadLoyalty();
    this.isInitialLoad = false;

    // Automatically load promos once tenant is identified
    effect(() => {
      if (this.tenantService.tenant()) {
        this.loadPromos();
      }
    });

    // Automatically save cart whenever any relevant signal changes
    effect(() => {
      this.saveCart();
    });
  }

  loadPromos() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) {
      // If tenant isn't loaded yet, don't fire the request.
      // The constructor/effect or component will trigger this once tenant is identified.
      return;
    }

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

  createCheckoutSession(items: CartItem[], customerEmail: string, orderId?: string, metadata?: any) {
    const payload = {
      items: items.map(item => ({
        name: this.getItemDisplayName(item),
        quantity: item.quantity,
        product: { price: this.getItemUnitPrice(item) + this.getItemOptionsPrice(item) }
      })),
      customerEmail,
      orderId,
      metadata
    };
    return this.http.post<{ id: string, url: string }>(`${this.paymentUrl}/create-checkout-session`, payload);
  }

  private loadLoyalty() {
    const saved = localStorage.getItem('bakery_loyalty');
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      if (typeof parsed === 'number') {
        this.totalLoavesPurchased.set(parsed || 0);
        return;
      }
      if (parsed && typeof parsed === 'object') {
        this.totalLoavesPurchased.set(parsed.totalLoavesPurchased || 0);
        this.totalOrders.set(parsed.totalOrders || 0);
        this.qualifyingOrders.set(parsed.qualifyingOrders || 0);
      }
    } catch (e) {
      const legacyCount = parseInt(saved, 10);
      this.totalLoavesPurchased.set(Number.isNaN(legacyCount) ? 0 : legacyCount);
    }
  }

  saveLoyalty(data: { totalLoavesPurchased: number; totalOrders: number; qualifyingOrders: number }) {
    this.totalLoavesPurchased.set(data.totalLoavesPurchased);
    this.totalOrders.set(data.totalOrders);
    this.qualifyingOrders.set(data.qualifyingOrders);
    localStorage.setItem('bakery_loyalty', JSON.stringify(data));
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
      items: this.cartItems().map(item => ({
        ...item,
        product: {
          ...item.product,
          imageUrl: item.product.imageUrl?.startsWith('data:') ? '' : item.product.imageUrl,
          images: item.product.images?.map(img => img.startsWith('data:') ? '' : img).filter(img => img !== '')
        }
      })),
      fulfillmentType: this.fulfillmentType(),
      zipCode: this.zipCode(),
      notes: this.notes()
    };
    try {
      localStorage.setItem('bakery_cart', JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save cart to localStorage (quota exceeded)', e);
    }
  }

  addToCart(product: CalculatedRecipe, quantity: number = 1, notes?: string, selectedOptions?: { name: string; price: number }[], packOption?: PackOption) {
    const resolvedPackOption = packOption || this.getPackOptions(product)[0];
    this.cartItems.update(prev => {
      // For items with notes or specific options, we might want to treat them as unique line items
      // but for now let's check if an identical item (same product + same notes + same options) exists.
      const existing = prev.find(item =>
        ((item.product.id && item.product.id === product.id) || item.product.name === product.name) &&
        item.notes === notes &&
        JSON.stringify(item.selectedOptions) === JSON.stringify(selectedOptions) &&
        item.packOption?.id === resolvedPackOption?.id
      );

      let updated: CartItem[];
      if (existing) {
        updated = prev.map(item =>
          (item === existing)
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      } else {
        updated = [...prev, { product, quantity, notes, selectedOptions, packOption: resolvedPackOption }];
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

  updatePackOption(item: CartItem, packOption: PackOption | null) {
    this.cartItems.update(prev => prev.map(prevItem =>
      this.isSameCartItem(prevItem, item) ? { ...prevItem, packOption: packOption || undefined } : prevItem
    ));
  }

  getPackOptions(product: CalculatedRecipe): PackOption[] {
    if (product.category === 'BAGEL') {
      return [
        { id: 'single', label: 'Single Bagel', size: 1, price: 2 },
        { id: '4-pack', label: '4 Bagels (Pack)', size: 4, price: 8 },
        { id: '8-pack', label: '8 Bagels (Pack)', size: 8, price: 12 }
      ];
    }

    if (product.category === 'COOKIE') {
      return [
        { id: 'single', label: 'Single Cookie', size: 1, price: product.price || 0 },
        { id: '6-pack', label: '6 Cookies (Pack)', size: 6, price: 8 },
        { id: '13-pack', label: '13 Cookies (Pack)', size: 13, price: 16 }
      ];
    }

    if (product.name.toLowerCase().includes('cinnamon roll')) {
      return [
        { id: 'single', label: 'Single Cinnamon Roll', size: 1, price: 5 },
        { id: '2-pack', label: '2 Cinnamon Rolls (Pack)', size: 2, price: 10 },
        { id: '4-pack', label: '4 Cinnamon Rolls (Pack)', size: 4, price: 18 }
      ];
    }

    return [];
  }

  getItemUnitPrice(item: CartItem): number {
    const packOption = this.resolvePackOption(item);
    return packOption?.price ?? item.product.price ?? 12;
  }

  getItemOptionsPrice(item: CartItem): number {
    return (item.selectedOptions || []).reduce((sum, opt) => sum + opt.price, 0);
  }

  getItemDisplayName(item: CartItem): string {
    const packOption = this.resolvePackOption(item);
    if (packOption) {
      return `${item.product.name} (${packOption.label})`;
    }
    return item.product.name;
  }

  getPackSize(item: CartItem): number {
    const packOption = this.resolvePackOption(item);
    return packOption?.size ?? 1;
  }

  private resolvePackOption(item: CartItem): PackOption | undefined {
    return item.packOption || this.getPackOptions(item.product)[0];
  }

  private isSameCartItem(a: CartItem, b: CartItem): boolean {
    const sameProduct = (a.product.id && b.product.id && a.product.id === b.product.id) || a.product.name === b.product.name;
    return sameProduct
      && a.notes === b.notes
      && JSON.stringify(a.selectedOptions) === JSON.stringify(b.selectedOptions)
      && a.packOption?.id === b.packOption?.id;
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
