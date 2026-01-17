import { Injectable, signal, computed, inject } from '@angular/core';
import { CalculatedRecipe } from '../logic/bakers-math';
import { SubscriptionService } from './subscription.service';
import { AuthService } from './auth.service';

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
  private cartItems = signal<CartItem[]>([]);
  fulfillmentType = signal<FulfillmentType>('PICKUP');
  zipCode = signal<string>('');
  notes = signal<string>('');

  // Perks / Loyalty
  totalLoavesPurchased = signal<number>(0);
  discountClaimed = signal<boolean>(false);

  // Selectors
  items = computed(() => this.cartItems());

  totalCount = computed(() =>
    this.cartItems().reduce((acc, item) => acc + item.quantity, 0)
  );

  loyaltyDiscount = computed(() => {
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
    return itemsTotal + this.shippingCost() - this.loyaltyDiscount();
  });

  private subscriptionService = inject(SubscriptionService);
  private authService = inject(AuthService);

  constructor() {
    this.loadCart();
    this.loadLoyalty();
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
      const existing = prev.find(item => item.product.id === product.id);
      let updated: CartItem[];
      if (existing) {
        updated = prev.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        updated = [...prev, { product, quantity: 1 }];
      }
      return updated;
    });
    this.saveCart();
  }

  removeFromCart(productId: string) {
    this.cartItems.update(prev => prev.filter(item => item.product.id !== productId));
    this.saveCart();
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
    this.saveCart();
  }

  toggleSubscription(productId: string) {
    this.cartItems.update(prev =>
      prev.map(item =>
        item.product.id === productId
          ? { ...item, isSubscription: !item.isSubscription }
          : item
      )
    );
    this.saveCart();
  }

  setFulfillment(type: FulfillmentType) {
    this.fulfillmentType.set(type);
    this.saveCart();
  }

  setZipCode(zip: string) {
    this.zipCode.set(zip);
    this.saveCart();
  }

  setNotes(notes: string) {
    this.notes.set(notes);
    this.saveCart();
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
    this.saveCart();
  }
}
