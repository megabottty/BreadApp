import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, Order, PackOption } from '../logic/bakers-math';
import { resolvePackOptions } from '../logic/pack-options';
import { ModalService } from './modal.service';
import { TenantService } from './tenant.service';

import { environment } from '../../environments/environment';

export type FulfillmentType = 'PICKUP' | 'SHIPPING';

export type { PackOption };

export interface CartProduct {
  id?: string;
  name: string;
  category: CalculatedRecipe['category'];
  price?: number;
  trueHydration?: number;
  ingredients?: CalculatedRecipe['ingredients'];
  packOptions?: PackOption[];
  itemWeightGrams?: number;
}

export interface CartItem {
  /** Unique per cart line, so two packs of the same product can be edited independently. */
  lineId: string;
  product: CartProduct;
  quantity: number;
  unitWeightGrams?: number;
  isSubscription?: boolean;
  notes?: string;
  selectedOptions?: { name: string; price: number }[];
  packOption?: PackOption;
}

/** One bag line as the server prices it. */
export interface CheckoutLine {
  recipeId: string;
  packOptionId: string | null;
  quantity: number;
  addons: string[];
  isSubscription: boolean;
}

export interface CheckoutCustomer {
  name: string;
  phone: string;
  email: string;
  notes: string;
  notificationPreference: 'SMS' | 'EMAIL' | 'BOTH';
}

export interface CheckoutRequest {
  lines: CheckoutLine[];
  pickupDate: string;
  promoCode?: string;
  customer: CheckoutCustomer;
  /** Same key for retries of one attempt, so a double tap can't place two orders. */
  attemptKey: string;
}

export interface CheckoutQuote {
  subtotal: number;
  promoDiscount: number;
  loyaltyDiscount: number;
  discount: number;
  total: number;
  promo: { code: string; description: string | null } | null;
}

export interface AppliedPromo {
  code: string;
  description: string;
}

export interface CheckoutStatus {
  paid: boolean;
  order?: Order | null;
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

  private tenantService = inject(TenantService);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'thedailydough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  /** Confirmation page: is this card checkout paid, and what was ordered. */
  getCheckoutStatus(orderId: string, sessionId: string) {
    return this.http.get<CheckoutStatus>(`${this.paymentUrl}/checkout-status`, {
      params: { order_id: orderId, session_id: sessionId }
    });
  }

  fulfillmentType = signal<FulfillmentType>('PICKUP');
  zipCode = signal<string>('');
  notes = signal<string>('');

  /** A promo code the server accepted for this bag. */
  appliedPromo = signal<AppliedPromo | null>(null);

  /** The server's price for the current bag (null until fetched, or if it failed). */
  serverQuote = signal<CheckoutQuote | null>(null);
  private quoteRequestId = 0;

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

  /** Discounts are decided by the server (promo codes from the dashboard). */
  promoDiscount = computed((): number => this.serverQuote()?.promoDiscount ?? 0);
  loyaltyDiscount = computed((): number => this.serverQuote()?.loyaltyDiscount ?? 0);

  totalWeight = computed(() =>
    this.cartItems().reduce((acc, item) => {
      const unitWeight = item.unitWeightGrams ?? this.getUnitWeightFromProduct(item.product);
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
    // The server's total is what gets charged; the local sum is only a
    // placeholder while the quote loads (and matches it when prices are current).
    const quote = this.serverQuote();
    if (quote) return quote.total;
    return Math.max(0, itemsTotal + this.shippingCost());
  });


  /** Chosen pickup day. Lives here (not in the cart page) so it is saved
   * with the bag and survives creating an account mid-checkout. */
  pickupDate = signal<string>('');

  constructor() {
    // The bag is saved in this browser so it survives a reload, and more
    // importantly the sign-up -> confirm-email -> log-in round-trip that a
    // subscription requires. (Loyalty stays server/session only.)
    this.loadCart();
    this.isInitialLoad = false;

    // Ask the server what this bag costs whenever its contents or promo change.
    effect(() => {
      const lines = this.checkoutLines();
      const promoCode = this.appliedPromo()?.code;
      this.tenantService.tenant();
      this.refreshQuote(lines, promoCode);
    });

    // Save the bag whenever any of its signals change.
    effect(() => {
      this.saveCart();
    });
  }

  /** What the server needs to price the bag: no prices, just choices. */
  checkoutLines = computed<CheckoutLine[]>(() => this.cartItems()
    .filter(item => !!item.product.id)
    .map(item => ({
      recipeId: item.product.id as string,
      packOptionId: this.resolvePackOption(item)?.id ?? null,
      quantity: item.quantity,
      addons: (item.selectedOptions || []).map(option => option.name),
      isSubscription: !!item.isSubscription
    })));

  private refreshQuote(lines: CheckoutLine[], promoCode: string | undefined): void {
    const requestId = ++this.quoteRequestId;
    if (lines.length === 0) {
      this.serverQuote.set(null);
      return;
    }
    this.http.post<CheckoutQuote>(`${this.paymentUrl}/quote`, { lines, promoCode }, { headers: this.headers }).subscribe({
      next: (quote) => {
        if (requestId === this.quoteRequestId) this.serverQuote.set(quote);
      },
      error: () => {
        if (requestId === this.quoteRequestId) this.serverQuote.set(null);
      }
    });
  }

  /** Checks a promo code with the server; resolves to an error message, or null when applied. */
  applyPromoCode(code: string): Promise<string | null> {
    const promoCode = code.toUpperCase().trim();
    if (!promoCode) return Promise.resolve('Enter a promo code.');
    return new Promise(resolve => {
      this.http.post<CheckoutQuote>(`${this.paymentUrl}/quote`, { lines: this.checkoutLines(), promoCode }, { headers: this.headers }).subscribe({
        next: (quote) => {
          if (!quote.promo) {
            resolve('That promo code isn\'t valid.');
            return;
          }
          this.serverQuote.set(quote);
          this.appliedPromo.set({ code: quote.promo.code, description: quote.promo.description || '' });
          resolve(null);
        },
        error: (err: { error?: { error?: string } }) => resolve(err?.error?.error || 'That promo code isn\'t valid.')
      });
    });
  }

  removePromo() {
    this.appliedPromo.set(null);
  }

  /** Pay at pickup: the server prices the bag and returns the new order's ID. */
  placePayAtPickupOrder(request: CheckoutRequest) {
    return this.http.post<{ orderId: string; totalPrice: number; duplicate?: boolean }>(this.apiUrl, request, { headers: this.headers });
  }

  createCheckoutSession(request: CheckoutRequest) {
    return this.http.post<{ id: string; url: string; orderId: string; total: number }>(
      `${this.paymentUrl}/create-checkout-session`, request, { headers: this.headers });
  }

  private loadLoyalty() {
    if (typeof localStorage === 'undefined') return;
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
    } catch {
      const legacyCount = parseInt(saved, 10);
      this.totalLoavesPurchased.set(Number.isNaN(legacyCount) ? 0 : legacyCount);
    }
  }

  saveLoyalty(data: { totalLoavesPurchased: number; totalOrders: number; qualifyingOrders: number }) {
    this.totalLoavesPurchased.set(data.totalLoavesPurchased);
    this.totalOrders.set(data.totalOrders);
    this.qualifyingOrders.set(data.qualifyingOrders);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('bakery_loyalty', JSON.stringify(data));
    }
  }

  private loadCart() {
    if (typeof localStorage === 'undefined') return;
    const saved = localStorage.getItem('bakery_cart');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const items = Array.isArray(data.items)
          ? data.items.map((item: CartItem) => this.normalizeCartItem(item))
          : [];
        this.cartItems.set(items);
        this.fulfillmentType.set('PICKUP'); // pickup only; shipping is not offered
        this.zipCode.set(data.zipCode || '');
        this.notes.set(data.notes || '');
        this.pickupDate.set(typeof data.pickupDate === 'string' ? data.pickupDate : '');
      } catch (e) {
        console.error('Error loading cart', e);
      }
    }
  }

  private saveCart() {
    if (typeof localStorage === 'undefined') return;
    const _data = {
      items: this.cartItems().map(item => this.toPersistedItem(item)),
      fulfillmentType: this.fulfillmentType(),
      zipCode: this.zipCode(),
      notes: this.notes(),
      pickupDate: this.pickupDate()
    };
    try {
      localStorage.setItem('bakery_cart', JSON.stringify(_data));
    } catch (e) {
      console.warn('Failed to save cart to localStorage (quota exceeded)', e);
    }
  }

  addToCart(product: CalculatedRecipe, quantity: number = 1, notes?: string, selectedOptions?: { name: string; price: number }[], packOption?: PackOption, isSubscription: boolean = false) {
    const resolvedPackOption = packOption || this.getPackOptions(product)[0];
    this.cartItems.update(prev => {
      // Merge into an identical line (same product, notes, options, pack and
      // purchase type); a one-time loaf and a weekly subscription of the same
      // loaf stay separate lines.
      const existing = prev.find(item =>
        ((item.product.id && item.product.id === product.id) || item.product.name === product.name) &&
        item.notes === notes &&
        JSON.stringify(item.selectedOptions) === JSON.stringify(selectedOptions) &&
        item.packOption?.id === resolvedPackOption?.id &&
        !!item.isSubscription === isSubscription
      );

      let updated: CartItem[];
      if (existing) {
        updated = prev.map(item =>
          (item === existing)
            ? { ...item, quantity: item.quantity + quantity }
            : item
        );
      } else {
        const unitWeightGrams = this.getUnitWeightFromProduct(product);
        const productSnapshot: CartProduct = {
          id: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          trueHydration: product.trueHydration,
          packOptions: product.packOptions,
          itemWeightGrams: product.itemWeightGrams
        };
        updated = [...prev, { lineId: this.newLineId(), product: productSnapshot, quantity, unitWeightGrams, notes, selectedOptions, packOption: resolvedPackOption, isSubscription }];
      }
      return updated;
    });
  }

  removeFromCart(lineId: string) {
    this.cartItems.update(prev => prev.filter(item => item.lineId !== lineId));
  }

  updateQuantity(lineId: string, quantity: number) {
    if (quantity <= 0) {
      this.removeFromCart(lineId);
      return;
    }
    this.cartItems.update(prev =>
      prev.map(item =>
        item.lineId === lineId ? { ...item, quantity } : item
      )
    );
  }

  updatePackOption(item: CartItem, packOption: PackOption | null) {
    this.cartItems.update(prev => prev.map(prevItem =>
      prevItem.lineId === item.lineId ? { ...prevItem, packOption: packOption || undefined } : prevItem
    ));
  }

  getPackOptions(product: CartProduct | CalculatedRecipe): PackOption[] {
    return resolvePackOptions(product);
  }

  getItemUnitPrice(item: CartItem): number {
    const packOption = this.resolvePackOption(item);
    return packOption?.price ?? item.product.price ?? 0;
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

  /** The pack this line is priced at. A line's remembered pack is only
   * honoured if the product still offers it -- a cart restored from storage
   * may carry a pack that no longer exists (e.g. the old hard-coded
   * "single cinnamon roll $5"), and must not be charged at that price. */
  private resolvePackOption(item: CartItem): PackOption | undefined {
    const packs = this.getPackOptions(item.product);
    if (item.packOption) {
      return packs.find(pack => pack.id === item.packOption?.id) ?? packs[0];
    }
    return packs[0];
  }

  private newLineId(): string {
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private getUnitWeightFromProduct(product: CartProduct | CalculatedRecipe): number {
    // Prefer the finished per-item weight; the ingredient sum is the whole batch.
    if (product.itemWeightGrams && product.itemWeightGrams > 0) {
      return product.itemWeightGrams;
    }
    const ingredients = product.ingredients;
    if (!ingredients || ingredients.length === 0) {
      return 0;
    }
    return ingredients.reduce((sum, ing) => sum + ing.weight, 0);
  }

  private normalizeCartItem(item: CartItem): CartItem {
    const product = item?.product || { name: 'Item', category: 'OTHER' as CalculatedRecipe['category'] };
    const normalizedProduct: CartProduct = {
      id: product.id,
      name: product.name,
      category: product.category || 'OTHER',
      price: product.price,
      trueHydration: product.trueHydration,
      ingredients: product.ingredients,
      packOptions: product.packOptions,
      itemWeightGrams: product.itemWeightGrams
    };
    return {
      ...item,
      lineId: item.lineId || this.newLineId(),
      product: normalizedProduct,
      unitWeightGrams: item.unitWeightGrams ?? this.getUnitWeightFromProduct(normalizedProduct)
    };
  }

  private toPersistedItem(item: CartItem): CartItem {
    return {
      ...item,
      unitWeightGrams: item.unitWeightGrams ?? this.getUnitWeightFromProduct(item.product),
      product: {
        id: item.product.id,
        name: item.product.name,
        category: item.product.category,
        price: item.product.price,
        trueHydration: item.product.trueHydration,
        packOptions: item.product.packOptions,
        itemWeightGrams: item.product.itemWeightGrams
      }
    };
  }

  toggleSubscription(lineId: string) {
    this.cartItems.update(prev =>
      prev.map(item =>
        item.lineId === lineId
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
    // Weekly subscriptions are created by the server when Stripe confirms payment.
    this.cartItems.set([]);
    this.serverQuote.set(null);
    this.notes.set('');
    this.appliedPromo.set(null);
    this.saveCart();
  }
}
