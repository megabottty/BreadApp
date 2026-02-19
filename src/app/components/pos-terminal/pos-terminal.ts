import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TenantService } from '../../services/tenant.service';
import { ModalService } from '../../services/modal.service';
import { CalculatedRecipe, Order, OrderItem } from '../../logic/bakers-math';

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

  savedRecipes = signal<CalculatedRecipe[]>([]);
  cart = signal<OrderItem[]>([]);
  searchTerm = signal('');
  categoryFilter = signal('ALL');

  // Checkout form
  customerName = signal('Walk-in Customer');
  customerPhone = signal('');
  tableNumber = signal('');
  paymentMethod = signal<'CASH' | 'CARD'>('CARD');
  isProcessing = signal(false);

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

  cartTotal = computed(() => {
    return this.cart().reduce((sum, item) => {
      const recipe = this.savedRecipes().find(r => r.id === item.recipeId);
      return sum + (recipe?.price || 0) * item.quantity;
    }, 0);
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
        this.loadProducts();
      }
    });
  }

  loadProducts() {
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers: this.headers }).subscribe({
      next: (recipes) => this.savedRecipes.set(recipes),
      error: (err) => console.error('Failed to load POS products:', err)
    });
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
      totalPrice: this.cartTotal(),
      shippingCost: 0,
      paymentMethod: {
        brand: this.paymentMethod(),
        last4: 'POS'
      },
      createdAt: new Date().toISOString()
    };

    this.http.post(`${environment.apiUrl}/orders`, finalOrder, { headers: this.headers }).subscribe({
      next: () => {
        this.isProcessing.set(false);
        this.modalService.showAlert(`Order #${orderId} completed successfully!`, 'Sale Recorded', 'success');
        this.clearCart();
      },
      error: (err) => {
        this.isProcessing.set(false);
        console.error('POS checkout failed:', err);
        this.modalService.showAlert('Failed to record sale. Please try again.', 'Checkout Error', 'error');
      }
    });
  }
}
