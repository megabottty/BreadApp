import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { Order, CalculatedRecipe, Review } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { ReviewService } from '../../services/review.service';
import { SubscriptionService, Subscription } from '../../services/subscription.service';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient, HttpHeaders } from '@angular/common/http';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink],
  templateUrl: './profile.html',
  styleUrls: ['./profile.css']
})
export class ProfileComponent implements OnInit {
  authService = inject(AuthService);
  cartService = inject(CartService);
  reviewService = inject(ReviewService);
  subscriptionService = inject(SubscriptionService);
  modalService = inject(ModalService);
  route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);

  pastOrders = signal<Order[]>([]);

  // Review Form state
  reviewingOrderId = signal<string | null>(null);
  reviewingRecipeId = signal<string | null>(null);
  reviewRating = signal<number>(5);
  reviewComment = signal<string>('');

  userOrders = computed(() => {
    const user = this.authService.user();
    if (!user) return [];
    // Sort by date descending
    return this.pastOrders()
      .filter(o => o.customerId === user.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  });

  userSubscriptions = computed(() => {
    const user = this.authService.user();
    if (!user) return [];
    return this.subscriptionService.getSubscriptionsForUser(user.id)();
  });

  reviewsCount = this.reviewService.getUserReviewsCount(this.authService.user()?.id || '');
  loavesPurchased = this.cartService.totalLoavesPurchased;

  reviewPerkProgress = computed(() => {
    return Math.min(100, (this.reviewsCount() % 10) * 10);
  });

  loafPerkProgress = computed(() => {
    return Math.min(100, (this.loavesPurchased() % 10) * 10);
  });

  constructor() {
    this.loadOrders();

    // Listen for storage changes in case an order is placed in another tab or after redirect
    window.addEventListener('storage', (e) => {
      if (e.key === 'bakery_orders') {
        this.loadOrders();
      }
    });
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['success'] === 'true') {
        const orderId = params['orderId'];
        this.modalService.showAlert(`Payment successful for Order #${orderId}! Your bread is on the way.`, 'Success', 'success');
        this.cartService.clearCart();
      }
    });

    const user = this.authService.user();
    if (user) {
      this.subscriptionService.fetchSubscriptionsForUser(user.id);
    }
  }

  loadOrders() {
    // Attempt to load from database if user is authenticated
    const user = this.authService.user();
    if (user) {
      const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
      const headers = new HttpHeaders().set('x-tenant-slug', slug);
      this.http.get<Order[]>(`http://localhost:3000/api/orders`, { headers }).subscribe({
        next: (orders) => {
          // Filter orders for this specific customer
          const myOrders = orders.filter(o => o.customerId === user.id);
          if (myOrders.length > 0) {
            this.pastOrders.set(myOrders);
            localStorage.setItem('bakery_orders', JSON.stringify(myOrders));
            this.updateLoyalty(myOrders);
            return;
          }
          this.loadFromLocalStorage();
        },
        error: () => this.loadFromLocalStorage()
      });
    } else {
      this.loadFromLocalStorage();
    }
  }

  private loadFromLocalStorage() {
    const savedOrders = localStorage.getItem('bakery_orders');
    let orders: Order[] = [];
    if (savedOrders) {
      try {
        orders = JSON.parse(savedOrders);
      } catch (e) {
        console.error('Error parsing saved orders', e);
      }
    }

    if (orders.length === 0) {
      // Mocking past orders
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      const lastWeekStr = lastWeek.toISOString().split('T')[0];

      orders = [
        {
          id: 'old-1',
          customerId: 'c1',
          customerName: 'Bread Lover',
          customerPhone: '555-0123',
          type: 'PICKUP',
          status: 'COMPLETED',
          pickupDate: lastWeekStr,
          items: [{ recipeId: 'r1', name: 'Country Loaf', quantity: 2, weightGrams: 900 }],
          notes: 'Please leave on the porch chair.',
          totalPrice: 24,
          shippingCost: 0,
          createdAt: lastWeekStr
        }
      ];
    }

    this.pastOrders.set(orders);
    this.updateLoyalty(orders);
  }

  private updateLoyalty(orders: Order[]) {
    const total = orders
      .filter(o => o.status === 'COMPLETED')
      .reduce((acc, o) => acc + o.items.reduce((sum, i) => sum + i.quantity, 0), 0);
    this.cartService.saveLoyalty(total);
  }

  reorder(order: Order) {
    // Get current products to ensure we have the latest prices/details
    const productsStr = localStorage.getItem('bakery_recipes');
    const allProducts: CalculatedRecipe[] = productsStr ? JSON.parse(productsStr) : [];

    order.items.forEach(item => {
       const existingProduct = allProducts.find(p => p.id === item.recipeId || p.name === item.name);
       const mockProduct: CalculatedRecipe = existingProduct || {
         id: item.recipeId,
         name: item.name,
         category: 'BREAD',
         price: 12,
         ingredients: [],
         totalFlour: 500,
         totalWater: 350,
         trueHydration: 0.7,
         totalNutrition: { calories: 1500, protein: 50, carbs: 300, fat: 10 }
       };
       for(let i=0; i<item.quantity; i++) {
         this.cartService.addToCart(mockProduct);
       }
    });
    this.modalService.showAlert('Items from your past order have been added to your bag!', 'Reordered');
  }

  startReview(orderId: string, recipeId: string) {
    this.reviewingOrderId.set(orderId);
    this.reviewingRecipeId.set(recipeId);
    this.reviewRating.set(5);
    this.reviewComment.set('');
  }

  submitReview() {
    const user = this.authService.user();
    const recipeId = this.reviewingRecipeId();
    if (!user || !recipeId) return;

    const review: Review = {
      id: Date.now().toString(),
      recipeId: recipeId,
      customerId: user.id,
      customerName: user.name,
      rating: this.reviewRating(),
      comment: this.reviewComment(),
      date: new Date().toISOString()
    };

    this.reviewService.addReview(review);
    this.reviewingOrderId.set(null);
    this.reviewingRecipeId.set(null);

    // Refresh reviews count or perks if necessary
    // this.reviewsCount() is already a computed from reviewService.getUserReviewsCount

    if (this.reviewService.getUserReviewsCount(user.id)() % 10 === 0 && this.reviewService.getUserReviewsCount(user.id)() > 0) {
      this.modalService.showAlert('Congratulations! You\'ve earned a FREE LOAF for leaving 10 reviews! (Contact baker to claim)', 'Loyalty Perk!', 'success');
    } else {
      this.modalService.showAlert('Thank you for your review!', 'Review Submitted', 'success');
    }
  }

  cancelReview() {
    this.reviewingOrderId.set(null);
    this.reviewingRecipeId.set(null);
  }

  cancelSubscription(id: string) {
    if (confirm('Are you sure you want to cancel this subscription?')) {
      this.subscriptionService.cancelSubscription(id);
    }
  }

  claimReviewPerk() {
    this.cartService.applyPromoCode('FREELOAF');
    this.modalService.showAlert('Your Free Loaf reward has been applied to your bag! 🥖', 'Reward Claimed', 'success');
  }

  claimLoafPerk() {
    this.cartService.applyPromoCode('DOUGH8');
    this.modalService.showAlert('Your $8 "Bread Addict" discount has been applied to your bag! 💸', 'Reward Claimed', 'success');
  }

  pauseSubscription(id: string) {
    this.subscriptionService.pauseSubscription(id);
  }

  resumeSubscription(id: string) {
    this.subscriptionService.resumeSubscription(id);
  }
}
