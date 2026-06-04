import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CartService, CartItem, FulfillmentType, PackOption } from '../../services/cart.service';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';
import { Order, OrderItem } from '../../logic/bakers-math';
import { ActivatedRoute } from '@angular/router';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, PercentPipe, FormsModule, MatCheckboxModule],
  templateUrl: './cart.html',
  styleUrls: ['./cart.css']
})
export class CartComponent implements OnInit {
  cartService = inject(CartService);
  notificationService = inject(NotificationService);
  authService = inject(AuthService);
  modalService = inject(ModalService);
  tenantService = inject(TenantService);
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
  guestEmail = signal<string>('');

  notifyBySms = signal<boolean>(false);
  notifyByEmail = signal<boolean>(true);

  orderEmail = computed(() => {
    if (this.authService.isAuthenticated()) {
      return this.authService.user()?.email || '';
    }
    return this.guestEmail();
  });

  promoCodeInput = signal<string>('');

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

  checkoutBlockedReason = computed(() => {
    if (this.fulfillmentType() === 'SHIPPING' && !this.dispatchDate()) {
      return 'Please select a dispatch date (Monday or Tuesday)';
    }
    if (this.fulfillmentType() === 'SHIPPING' && !this.isDispatchDateValid(this.dispatchDate())) {
      return 'Dispatch date must be a Monday or Tuesday, at least 48 hours from now';
    }
    if (this.fulfillmentType() === 'PICKUP' && !this.pickupDate()) {
      return 'Please select a pickup date';
    }
    if (this.fulfillmentType() === 'PICKUP' && !this.isPickupDateValid(this.pickupDate())) {
      return 'Pickup date must be at least 48 hours from now';
    }
    if (!this.authService.isAuthenticated() && !this.guestName()) {
      return 'Please enter your name for guest checkout';
    }
    if (!this.notifyBySms() && !this.notifyByEmail()) {
      return 'Please select at least one notification method';
    }
    if (this.notifyBySms() && !this.guestPhone()) {
      return 'Please enter your phone number for SMS updates';
    }
    const customerEmail = this.getCustomerEmail();
    if (this.notifyByEmail() && !customerEmail) {
      return 'Please enter your email address for order updates';
    }
    return null;
  });

  // Monday = 1, Tuesday = 2
  isDispatchDateValid = (date: string) => {
    if (!date) return false;

    const selected = new Date(date);
    const min = new Date(this.minDate());
    if (selected < min) return false;

    const day = selected.getUTCDay();
    return day === 1 || day === 2;
  };

  isPickupDateValid = (date: string) => {
    if (!date) return false;
    const selected = new Date(date);
    const min = new Date(this.minDate());
    return selected >= min;
  };

  updateQuantity(item: CartItem, change: number) {
    if (item.product.id) {
      this.cartService.updateQuantity(item.product.id, item.quantity + change);
    }
  }

  getPackOptions(item: CartItem): PackOption[] {
    return this.cartService.getPackOptions(item.product);
  }

  onPackChange(item: CartItem, packId: string) {
    const option = this.getPackOptions(item).find(pack => pack.id === packId) || null;
    this.cartService.updatePackOption(item, option);
  }

  itemDisplayName(item: CartItem): string {
    return this.cartService.getItemDisplayName(item);
  }

  itemUnitPrice(item: CartItem): number {
    return this.cartService.getItemUnitPrice(item) + this.cartService.getItemOptionsPrice(item);
  }

  private buildOrderItems(): OrderItem[] {
    return this.items().map(item => {
      const packSize = this.cartService.getPackSize(item);
      const unitCount = item.quantity * packSize;
      const unitWeight = item.unitWeightGrams ?? item.product.ingredients?.reduce((sum, ing) => sum + ing.weight, 0) ?? 0;
      return {
        recipeId: item.product.id || '',
        name: this.cartService.getItemDisplayName(item),
        quantity: unitCount,
        weightGrams: unitWeight * unitCount
      };
    });
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

  applyPromo() {
    if (!this.promoCodeInput()) return;
    const success = this.cartService.applyPromoCode(this.promoCodeInput());
    if (success) {
      this.modalService.showAlert(`Promo code "${this.promoCodeInput()}" applied!`, 'Success', 'success');
      this.promoCodeInput.set('');
    } else {
      this.modalService.showAlert('Invalid promo code. Please try again.', 'Invalid Code', 'warning');
    }
  }

  removePromo() {
    this.cartService.removePromo();
  }

  onOrderEmailChange(value: string) {
    if (!this.authService.isAuthenticated()) {
      this.guestEmail.set(value);
    }
  }

  private getCustomerEmail(): string {
    if (this.authService.isAuthenticated()) {
      return this.authService.user()?.email || '';
    }
    return this.guestEmail();
  }

  private getNotificationPreference(): Order['notificationPreference'] {
    if (this.notifyBySms() && this.notifyByEmail()) return 'BOTH';
    if (this.notifyBySms()) return 'SMS';
    if (this.notifyByEmail()) return 'EMAIL';
    return 'NONE';
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
    if (isGuest && !this.guestName()) {
      this.modalService.showAlert('Please provide your name for guest checkout.', 'Missing Information', 'warning');
      return;
    }

    if (!this.notifyBySms() && !this.notifyByEmail()) {
      this.modalService.showAlert('Please select at least one notification method.', 'Missing Information', 'warning');
      return;
    }

    if (this.notifyBySms() && !this.guestPhone()) {
      this.modalService.showAlert('Please provide a phone number to receive SMS updates.', 'Missing Information', 'warning');
      return;
    }

    const customerEmail = this.getCustomerEmail();
    if (this.notifyByEmail() && !customerEmail) {
      this.modalService.showAlert('Please provide an email address to receive order updates.', 'Missing Information', 'warning');
      return;
    }

    const customerName = isGuest ? this.guestName() : (this.authService.user()?.name || 'Valued Customer');
    const customerPhone = this.guestPhone();
    const notificationPreference = this.getNotificationPreference();

    // If paying at pickup, create order immediately (payment happens later at pickup)
    if (this.payAtPickup() && this.fulfillmentType() === 'PICKUP') {
      const orderId = 'POS-' + Math.random().toString(36).substring(7).toUpperCase();
      logger.info('Pay at pickup selected - creating order without payment...');

      const newOrder: Order = {
        id: orderId,
        customerId: isGuest ? 'guest' : (this.authService.user()?.id || 'unknown'),
        customerName: customerName,
        customerPhone: customerPhone,
        customerEmail: customerEmail,
        notificationPreference,
        type: this.fulfillmentType(),
        status: 'PENDING',
        paymentStatus: 'PENDING',
        pickupDate: this.pickupDate(),
        items: this.buildOrderItems(),
        notes: this.notes(),
        totalPrice: this.totalPrice(),
        promoCode: this.cartService.appliedPromo()?.code,
        discountApplied: this.cartService.promoDiscount() + this.cartService.loyaltyDiscount(),
        shippingCost: this.shippingCost(),
        createdAt: new Date().toISOString()
      };

      this.cartService.saveOrderToDatabase(newOrder).subscribe({
        next: (response) => {
          logger.info('Order synced to cloud successfully:', response);
          this.notificationService.sendOrderConfirmation(customerName, customerPhone, customerEmail, orderId, notificationPreference);
          this.notificationService.sendBakerOrderAlert(orderId, customerName);
          this.modalService.showAlert(
            `Thank you for your order, ${customerName}!\n\nConfirmation #${orderId}\n\nPickup Date: ${this.pickupDate()}\n\nYou can pay when you pick up your order. We'll send updates based on your notification preferences.`,
            'Order Confirmed',
            'success'
          );
          this.cartService.clearCart();
          this.pickupDate.set('');
          this.guestName.set('');
          this.guestPhone.set('');
          this.guestEmail.set('');
        },
        error: (err) => {
          logger.error('Cloud sync failed. Check if backend is running:', err);
          this.modalService.showAlert('Could not connect to the backend server. Make sure it is running (npm run server).', 'Connection Error', 'error');
        }
      });
      return;
    }

    // For card payments: Create Stripe session FIRST (don't create order yet)
    // Order will be created by webhook after successful payment
    logger.info('Initiating Stripe Checkout (order will be created after payment)...');
    const email = customerEmail || 'customer@example.com';

    // Pass order details as metadata to Stripe
    const orderId = 'ORD-' + Math.random().toString(36).substring(7).toUpperCase();
    const orderItems = this.buildOrderItems();
    const itemsSubtotal = this.items().reduce((sum, item) =>
      sum + (item.quantity * (this.cartService.getItemUnitPrice(item) + this.cartService.getItemOptionsPrice(item))),
    0);
    const tenantSlug = this.tenantService.tenant()?.slug || 'the-daily-dough';

    const orderMetadata = {
      orderId,
      tenantSlug,
      customerName,
      customerPhone,
      customerEmail,
      notificationPreference: notificationPreference || 'NONE',
      customerId: isGuest ? 'guest' : (this.authService.user()?.id || 'unknown'),
      fulfillmentType: this.fulfillmentType(),
      pickupDate: this.fulfillmentType() === 'PICKUP' ? this.pickupDate() : this.dispatchDate(),
      notes: this.notes(),
      promoCode: this.cartService.appliedPromo()?.code || '',
      discountApplied: (this.cartService.promoDiscount() + this.cartService.loyaltyDiscount()).toString(),
      shippingCost: this.shippingCost().toString(),
      subtotal: itemsSubtotal.toString(),
      orderItems: JSON.stringify(orderItems)
    };

    // Prepare items for Stripe, marking subscriptions
    const stripeItems = this.items().map(item => ({
      name: this.itemDisplayName(item),
      price: this.cartService.getItemUnitPrice(item) + this.cartService.getItemOptionsPrice(item),
      quantity: item.quantity,
      isSubscription: !!item.isSubscription
    }));

    this.cartService.createCheckoutSession(stripeItems, email, orderId, orderMetadata).subscribe({
      next: (session) => {
        logger.info('Stripe session created:', session);
        if (session.url) {
          window.location.href = session.url; // Redirect to Stripe
        }
      },
      error: (err) => {
        logger.error('Stripe session creation failed:', err);
        this.modalService.showAlert('Failed to initiate payment. Please make sure your backend server is running on port 3000.', 'Payment Error', 'error');
      }
    });
  }
}
