import { Component, inject, signal, computed, effect } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TenantService } from '../../services/tenant.service';
import { ModalService } from '../../services/modal.service';
import { TaxService } from '../../services/tax.service';
import { ToastService } from '../../services/toast.service';
import { CalculatedRecipe, Order, OrderItem } from '../../logic/bakers-math';
import { RecipeService } from '../../services/recipe.service';


@Component({
  selector: 'app-pos-terminal',
  standalone: true,
  imports: [CommonModule, FormsModule, CurrencyPipe],
  templateUrl: './pos-terminal.html',
  styleUrls: ['./pos-terminal.css']
})
export class PosTerminalComponent {
  private http = inject(HttpClient);
  public tenantService = inject(TenantService);
  private modalService = inject(ModalService);
  private helpService = inject(HelpService);
  private taxService = inject(TaxService);
  private toastService = inject(ToastService);
  private recipeService = inject(RecipeService);

  savedRecipes = this.recipeService.savedRecipes;
  cart = signal<OrderItem[]>([]);
  searchTerm = signal('');
  categoryFilter = signal('ALL');

  // Checkout form
  customerName = signal('Walk-in Customer');
  customerPhone = signal('');
  tableNumber = signal('');
  paymentMethod = signal<'CASH' | 'CARD'>('CARD');
  isProcessing = signal(false);
  paymentQrCode = signal<string | null>(null);
  showQrModal = signal(false);
  qrPaymentTotal = signal(0);

  categories = computed(() => {
    const cats = new Set(this.savedRecipes().map(r => r.category));
    return ['ALL', ...Array.from(cats)];
  });

  filteredProducts = computed(() => {
    let products = this.savedRecipes();
    const search = this.searchTerm().toLowerCase();
    const cat = this.categoryFilter();

    if (cat !== 'ALL') {
      products = products.filter(r => r.category === cat);
    }

    if (search) {
      products = products.filter(r =>
        r.name.toLowerCase().includes(search) ||
        r.category.toLowerCase().includes(search)
      );
    }

    return products;
  });

  cartSubtotal = computed(() => {
    return this.cart().reduce((sum, item) => {
      const recipe = this.savedRecipes().find(r => r.id === item.recipeId);
      return sum + (recipe?.price || 0) * item.quantity;
    }, 0);
  });

  cartTax = computed(() => {
    const subtotal = this.cartSubtotal();
    return this.taxService.calculateTax(subtotal);
  });

  cartTotal = computed(() => {
    return this.cartSubtotal() + this.cartTax();
  });

  cartWithPrices = computed(() => {
    return this.cart().map(item => {
      const recipe = this.savedRecipes().find(r => r.id === item.recipeId);
      return {
        ...item,
        price: recipe?.price || 0
      };
    });
  });

  private get headers() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return new HttpHeaders();
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  constructor() {
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        this.recipeService.loadRecipes();
        this.taxService.loadTaxSettings();
      }
    });
  }

  loadProducts() {
    // Delegated to RecipeService
    this.recipeService.loadRecipes();
  }

  addToCart(product: CalculatedRecipe) {
    this.cart.update(items => {
      const existing = items.find(i => i.recipeId === product.id);
      if (existing) {
        return items.map(i => i.recipeId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      } else {
        return [...items, {
          recipeId: product.id || '',
          name: product.name,
          quantity: 1,
          weightGrams: product.ingredients.reduce((sum, ing) => sum + ing.weight, 0)
        }];
      }
    });
  }

  removeFromCart(index: number) {
    this.cart.update(items => {
      const newItems = [...items];
      newItems.splice(index, 1);
      return newItems;
    });
  }

  updateQuantity(index: number, delta: number) {
    this.cart.update(items => {
      const newItems = [...items];
      const item = newItems[index];
      if (item) {
        item.quantity = Math.max(1, item.quantity + delta);
      }
      return newItems;
    });
  }

  clearCart() {
    this.cart.set([]);
    this.customerName.set('Walk-in Customer');
    this.customerPhone.set('');
    this.tableNumber.set('');
  }

  checkout() {
    const items = this.cart();
    if (items.length === 0) return;

    this.isProcessing.set(true);

    const orderId = 'POS-' + Math.random().toString(36).substring(7).toUpperCase();

    // Check payment method
    if (this.paymentMethod() === 'CASH') {
      // Cash payment - complete immediately
      this.completeCashOrder(orderId);
    } else {
      // Card payment - create Stripe payment link
      this.createCardPayment(orderId);
    }
  }

  private completeCashOrder(orderId: string) {
    const items = this.cart();

    const finalOrder: Order = {
      id: orderId,
      customerId: 'pos',
      customerName: this.customerName(),
      customerPhone: this.customerPhone(),
      type: 'PICKUP',
      orderSource: 'WALK_IN',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      tableNumber: this.tableNumber(),
      items: items,
      subtotal: this.cartSubtotal(),
      taxAmount: this.cartTax(),
      totalPrice: this.cartTotal(),
      shippingCost: 0,
      paymentMethod: {
        brand: 'CASH',
        last4: 'CASH'
      },
      createdAt: new Date().toISOString()
    };

    this.http.post(`${environment.apiUrl}/orders`, finalOrder, { headers: this.headers }).subscribe({
      next: () => {
        this.isProcessing.set(false);
        this.toastService.success(`Cash payment received! Order #${orderId} - Total: $${this.cartTotal().toFixed(2)}`);
        this.clearCart();
      },
      error: (err) => {
        this.isProcessing.set(false);
        console.error('POS checkout failed:', err);
      }
    });
  }

  private createCardPayment(_orderId: string) {
    // DON'T create order yet - it will be created by webhook after payment
    // Just create Stripe session with order details in metadata
    const subtotal = this.cartSubtotal();
    const tax = this.cartTax();
    const total = subtotal + tax;

    const metadata = {
      customerName: this.customerName(),
      customerPhone: this.customerPhone(),
      tableNumber: this.tableNumber(),
      orderSource: 'WALK_IN',
      subtotal: subtotal.toString(),
      taxAmount: tax.toString(),
      totalPrice: total.toString(),
      mode: 'pos'
    };

    const lineItems = this.cart().map(item => {
      const product = this.savedRecipes().find(r => r.id === item.recipeId);
      return {
        name: item.name,
        price: product?.price || 0,
        quantity: item.quantity
      };
    });

    // Stripe Checkout total is based on line items, so include tax as a line item to match POS total.
    if (tax > 0) {
      lineItems.push({
        name: 'Sales Tax',
        price: tax,
        quantity: 1
      });
    }

    const checkoutData = {
      items: lineItems,
      customerEmail: this.customerPhone() ? `${this.customerPhone()}@pos.temp` : 'pos@example.com',
      metadata: metadata
    };

    this.http.post<{ url: string }>(`${environment.apiUrl}/payments/create-checkout-session`, checkoutData, {
      headers: this.headers
    }).subscribe({
      next: async (session) => {
        this.isProcessing.set(false);
        if (session.url) {
          this.qrPaymentTotal.set(total);
          // Generate QR code for the payment link
          try {
            const qrCodeDataUrl = await (await import('qrcode')).toDataURL(session.url, {
              width: 300,
              margin: 2,
              color: {
                dark: '#000000',
                light: '#FFFFFF'
              }
            });
            this.paymentQrCode.set(qrCodeDataUrl);
            this.showQrModal.set(true);
          } catch (err) {
            console.error('Failed to generate QR code:', err);
            // Fallback to showing URL if QR generation fails
            this.modalService.showAlert(
              `Payment link created! Have customer visit:\n\n${session.url}\n\nOrder will be created when payment is received.`,
              `Total: $${total.toFixed(2)}`,
              'info'
            );
          }
          this.clearCart();
        }
      },
      error: (err) => {
        this.isProcessing.set(false);
        console.error('Failed to create payment link:', err);
        this.toastService.error('Failed to create payment link.');
      }
    });
  }

  closeQrModal() {
    this.showQrModal.set(false);
    this.paymentQrCode.set(null);
    this.qrPaymentTotal.set(0);
  }

  showHint() {
    const hint = this.helpService.getHint('pos');
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }
}
