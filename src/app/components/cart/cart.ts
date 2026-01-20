import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CartService, CartItem, FulfillmentType } from '../../services/cart.service';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
import { Order, OrderItem } from '../../logic/bakers-math';
import { ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, PercentPipe, FormsModule],
  templateUrl: './cart.html',
  styleUrls: ['./cart.css']
})
export class CartComponent implements OnInit {
  cartService = inject(CartService);
  notificationService = inject(NotificationService);
  authService = inject(AuthService);
  modalService = inject(ModalService);
  route = inject(ActivatedRoute);

  items = this.cartService.items;
  totalPrice = this.cartService.totalPrice;
  shippingCost = this.cartService.shippingCost;
  fulfillmentType = this.cartService.fulfillmentType;
  zipCode = this.cartService.zipCode;
  notes = this.cartService.notes;

  dispatchDate = signal<string>('');
  pickupDate = signal<string>('');
  payAtPickup = signal<boolean>(false);

  guestName = signal<string>('');
  guestPhone = signal<string>('');

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['canceled'] === 'true') {
        this.modalService.showAlert('Payment was canceled. You can review your cart and try again.', 'Payment Canceled', 'info');
      }
    });
  }

  minDate = computed(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2); // 48 hour buffer
    return d.toISOString().split('T')[0];
  });

  // Monday = 1, Tuesday = 2
  isDispatchDateValid = (date: string) => {
    if (!date) return true;

    const selected = new Date(date);
    const min = new Date(this.minDate());
    if (selected < min) return false;

    const day = selected.getUTCDay();
    return day === 1 || day === 2;
  };

  isPickupDateValid = (date: string) => {
    if (!date) return true;
    const selected = new Date(date);
    const min = new Date(this.minDate());
    return selected >= min;
  };

  updateQuantity(item: CartItem, change: number) {
    if (item.product.id) {
      this.cartService.updateQuantity(item.product.id, item.quantity + change);
    }
  }

  setFulfillment(type: FulfillmentType) {
    this.cartService.setFulfillment(type);
    if (type === 'SHIPPING') {
      this.payAtPickup.set(false);
    }
  }

  onZipChange(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.cartService.setZipCode(val);
  }

  removeItem(item: CartItem) {
    if (item.product.id) {
      this.cartService.removeFromCart(item.product.id);
    }
  }

  toggleSubscription(item: CartItem) {
    if (item.product.id) {
      this.cartService.toggleSubscription(item.product.id);
    }
  }

  checkout() {
    if (this.fulfillmentType() === 'SHIPPING' && !this.isDispatchDateValid(this.dispatchDate())) {
      this.modalService.showAlert('For shipping, please select a Monday or Tuesday dispatch date at least 48 hours from now.', 'Invalid Date', 'warning');
      return;
    }

    if (this.fulfillmentType() === 'PICKUP' && !this.isPickupDateValid(this.pickupDate())) {
      this.modalService.showAlert('Please select a pickup date at least 48 hours from now.', 'Invalid Date', 'warning');
      return;
    }

    const isGuest = !this.authService.isAuthenticated();
    if (isGuest && (!this.guestName() || !this.guestPhone())) {
      this.modalService.showAlert('Please provide your name and phone number for guest checkout.', 'Missing Information', 'warning');
      return;
    }

    // Simulate Order Creation & Confirmation
    const orderId = Math.random().toString(36).substring(7).toUpperCase();
    const customerName = isGuest ? this.guestName() : (this.authService.user()?.name || 'Valued Customer');
    const customerPhone = isGuest ? this.guestPhone() : '555-0123';

    console.log('Order created with notes:', this.notes());
    this.notificationService.sendOrderConfirmation(customerName, customerPhone, orderId);
    this.notificationService.sendBakerOrderAlert(orderId, customerName);

    // Save order to history
    const newOrder: Order = {
      id: orderId,
      customerId: isGuest ? 'guest' : (this.authService.user()?.id || 'unknown'),
      customerName: customerName,
      customerPhone: customerPhone,
      type: this.fulfillmentType(),
      status: 'PENDING',
      pickupDate: this.fulfillmentType() === 'PICKUP' ? this.pickupDate() : this.dispatchDate(),
      items: this.items().map(item => ({
        recipeId: item.product.id || '',
        name: item.product.name,
        quantity: item.quantity,
        weightGrams: item.product.ingredients.reduce((sum, ing) => sum + ing.weight, 0)
      })),
      notes: this.notes(),
      totalPrice: this.totalPrice(),
      shippingCost: this.shippingCost(),
      createdAt: new Date().toISOString()
    };

    const savedOrders = localStorage.getItem('bakery_orders');
    let allOrders: Order[] = savedOrders ? JSON.parse(savedOrders) : [];
    allOrders.push(newOrder);
    localStorage.setItem('bakery_orders', JSON.stringify(allOrders));

    // Send order to real backend
    console.log('Attempting to sync order with backend...');
    this.cartService.saveOrderToDatabase(newOrder).subscribe({
      next: (response) => {
        console.log('Order synced to cloud successfully:', response);

        if (this.payAtPickup()) {
          this.modalService.showAlert(`Thank you for your order, ${customerName}! Confirmation # ${orderId} has been sent via SMS and saved to our bakery ledger.`, 'Order Confirmed', 'success');
          this.cartService.clearCart();
          return;
        }

        // After syncing order, initiate Stripe Checkout
        console.log('Initiating Stripe Checkout...');
        const email = isGuest ? (this.guestPhone() + '@guest.com') : (this.authService.user()?.email || 'customer@example.com');
        this.cartService.createCheckoutSession(this.items(), email, orderId).subscribe({
          next: (session) => {
            console.log('Stripe session created:', session);
            if (session.url) {
              window.location.href = session.url; // Redirect to Stripe
            }
          },
          error: (err) => {
            console.error('Stripe session creation failed:', err);
            this.modalService.showAlert('Failed to initiate payment. Please make sure your backend server is running on port 3000.', 'Payment Error', 'error');
          }
        });
      },
      error: (err) => {
        console.error('Cloud sync failed. Check if backend is running:', err);
        this.modalService.showAlert('Could not connect to the backend server. Make sure it is running (npm run server).', 'Connection Error', 'error');
      }
    });
  }
}
