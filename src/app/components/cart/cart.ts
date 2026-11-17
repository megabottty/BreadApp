import { Component, inject, signal, computed, effect, OnInit, DestroyRef } from '@angular/core';
import { CommonModule, CurrencyPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CartService, CartItem, PackOption, CheckoutRequest } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';
import { Order } from '../../logic/bakers-math';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SUBSCRIPTION_ACCOUNT_MESSAGE } from '../../services/subscription-gate.service';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, PercentPipe, FormsModule, MatCheckboxModule, RouterLink],
  templateUrl: './cart.html',
  styleUrls: ['./cart.css']
})
export class CartComponent implements OnInit {
  cartService = inject(CartService);
  authService = inject(AuthService);
  modalService = inject(ModalService);
  tenantService = inject(TenantService);
  route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  items = this.cartService.items;
  totalPrice = this.cartService.totalPrice;
  fulfillmentType = this.cartService.fulfillmentType;
  notes = this.cartService.notes;

  pickupDate = this.cartService.pickupDate;
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

  // --- Compact one-screen layout state (DoorDash-style): sections collapse
  // to a summary row on phones and open on demand; on wider screens the
  // bag and details start open because there's room.
  private readonly wideScreen = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches;
  bagExpanded = signal<boolean>(this.wideScreen);
  detailsExpanded = signal<boolean>(this.wideScreen);
  noteOpen = signal<boolean>(false);
  promoOpen = signal<boolean>(false);
  showOtherDate = signal<boolean>(false);
  /** Inline validation only appears after the first Place order attempt. */
  showValidation = signal<boolean>(false);

  /** True while an order or payment is being created; blocks a second tap. */
  submitting = signal<boolean>(false);
  /** Sent with the order so a retried request can't create a second one. New after each placed order. */
  private attemptKey: string = this.newAttemptKey();

  itemCount = computed(() => this.items().reduce((sum, item) => sum + item.quantity, 0));

  /** Lines that recur weekly. Drives the summary above Checkout, the button
   * label, and hides pay-at-pickup (a recurring charge needs a card). */
  subscriptionLines = computed(() => this.items().filter(item => !!item.isSubscription));
  hasSubscription = computed(() => this.subscriptionLines().length > 0);
  readonly subscriptionAccountMessage = SUBSCRIPTION_ACCOUNT_MESSAGE;

  /** Briefly pulses the subscription box whenever a subscription appears in
   * the bag (arriving from Subscribe, or ticking the weekly checkbox). */
  highlightSubscription = signal<boolean>(false);
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;

  /** Per-line total: quantity × (unit price + add-ons). */
  lineTotal(item: CartItem): number {
    return item.quantity * (this.cartService.getItemUnitPrice(item) + this.cartService.getItemOptionsPrice(item));
  }

  optionNames(item: CartItem): string {
    return (item.selectedOptions || []).map(option => option.name).join(', ');
  }

  itemsSubtotal = computed((): number => this.items().reduce((sum, item) => sum + this.lineTotal(item), 0));

  /** One clear button, like food-ordering checkouts: what happens, and for how much. */
  checkoutLabel = computed(() => {
    const total = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(this.totalPrice());
    if (this.hasSubscription()) return `Start subscription · ${total}`;
    if (this.payAtPickup()) return `Place order · pay ${total} at pickup`;
    return `Pay ${total}`;
  });

  constructor() {
    // Keep the details section open while something in it is still needed,
    // so the red fields are visible rather than hidden behind "Edit".
    effect(() => {
      if (this.sectionNeedsAttention('details')) this.detailsExpanded.set(true);
    });

    effect(() => {
      if (!this.hasSubscription()) {
        this.highlightSubscription.set(false);
        return;
      }
      this.highlightSubscription.set(true);
      if (this.highlightTimer) clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => this.highlightSubscription.set(false), 4500);
      if (typeof window !== 'undefined') {
        setTimeout(() => document.querySelector('.subscription-summary-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    });
  }

  ngOnInit() {
    if (typeof window !== 'undefined') {
      const timer = setInterval(() => this.bakeryToday.set(denverToday()), 60_000);
      this.destroyRef.onDestroy(() => clearInterval(timer));
    }
    this.route.queryParams.subscribe(params => {
      if (params['canceled'] === 'true') {
        this.modalService.showAlert('Payment was canceled. You can review your cart and try again.', 'Payment Canceled', 'info');
      }
    });
  }

  /** Today's date at the bakery (Denver), refreshed every minute so a page
   * left open past midnight still offers the right days. Matches the
   * server's checkPickupDate rule. */
  private bakeryToday = signal<string>(denverToday());

  /** Earliest pickup day: 2 days after today at the bakery. */
  minDate = computed((): string => addDaysToDate(this.bakeryToday(), 2));

  /** Days the bakery is closed (set in Business Settings). */
  closedDates = computed((): Set<string> => new Set(this.tenantService.tenant()?.closed_dates ?? []));

  /** Subscriptions are baked in the Monday/Tuesday batch, so instead of a free
   * date picker they choose from the next four weeks of Mondays and Tuesdays
   * (respecting the 48-hour lead time). Each following week repeats on the
   * same day. */
  subscriptionDateOptions = computed<{ value: string; label: string }[]>(() => {
    const options: { value: string; label: string }[] = [];
    const start = new Date(`${this.minDate()}T00:00:00Z`);
    for (let offset = 0; offset < 28; offset++) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + offset);
      const weekday = day.getUTCDay();
      if (weekday !== 1 && weekday !== 2) continue;
      if (this.closedDates().has(day.toISOString().slice(0, 10))) continue;
      options.push({
        value: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
      });
    }
    return options;
  });

  /** Tappable pickup days: the next 14 eligible days for one-time orders, or
   * the Monday/Tuesday choices for subscriptions. */
  dateChips = computed<{ value: string; weekday: string; day: string; month: string }[]>(() => {
    const values = this.hasSubscription()
      ? this.subscriptionDateOptions().map(option => option.value)
      : (() => {
          // The next 14 days the bakery is open (looking up to 60 days ahead).
          const open: string[] = [];
          for (let offset = 0; offset < 60 && open.length < 14; offset++) {
            const day = addDaysToDate(this.minDate(), offset);
            if (!this.closedDates().has(day)) open.push(day);
          }
          return open;
        })();
    return values.map(value => {
      const date = new Date(`${value}T00:00:00Z`);
      return {
        value,
        weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
        day: String(date.getUTCDate()),
        month: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
      };
    });
  });

  selectDate(value: string): void {
    this.pickupDate.set(value);
    this.showOtherDate.set(false);
  }

  formatChipDate(value: string): string {
    if (!value) return '';
    return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /** "Megan · megan@… · (801) 555-0123" for the collapsed details row. */
  detailsSummary = computed<string>(() => {
    const name = this.authService.isAuthenticated() ? (this.authService.user()?.name || '') : this.guestName();
    return [name, this.getCustomerEmail(), this.guestPhone()].map(part => (part || '').trim()).filter(Boolean).join(' · ');
  });

  /** Everything still needed before the order can go through, in page order.
   * Drives the red "needs attention" sections, the per-field hints, the
   * checklist by the button, and the disabled state of the button itself. */
  missingItems = computed<{ section: 'subscription' | 'pickup' | 'details'; field: string; message: string }[]>(() => {
    const missing: { section: 'subscription' | 'pickup' | 'details'; field: string; message: string }[] = [];
    if (this.hasSubscription() && !this.authService.isAuthenticated()) {
      missing.push({ section: 'subscription', field: 'account', message: 'Log in or create an account for the subscription' });
    }
    if (!this.pickupDate()) {
      missing.push({ section: 'pickup', field: 'date', message: this.hasSubscription() ? 'Choose a Monday or Tuesday for pickup' : 'Choose a pickup day' });
    } else if (this.closedDates().has(this.pickupDate())) {
      missing.push({ section: 'pickup', field: 'date', message: 'We\'re closed that day. Choose another pickup day' });
    } else if (!this.isPickupDateValid(this.pickupDate())) {
      missing.push({ section: 'pickup', field: 'date', message: this.hasSubscription() ? 'Pickup must be a Monday or Tuesday, at least 48 hours out' : 'Pickup must be at least 48 hours from now' });
    }
    if (!this.authService.isAuthenticated() && !this.guestName().trim()) {
      missing.push({ section: 'details', field: 'name', message: 'Add your name' });
    }
    if (!this.notifyBySms() && !this.notifyByEmail()) {
      missing.push({ section: 'details', field: 'updates', message: 'Pick email or text for order updates' });
    }
    const email = this.getCustomerEmail().trim();
    if (this.notifyByEmail() && !email) {
      missing.push({ section: 'details', field: 'email', message: 'Add your email address' });
    } else if (email && !EMAIL_PATTERN.test(email)) {
      missing.push({ section: 'details', field: 'email', message: 'Check your email address' });
    }
    const phone = this.guestPhone().trim();
    if (this.notifyBySms() && !phone) {
      missing.push({ section: 'details', field: 'phone', message: 'Add your phone number for texts' });
    } else if (phone && !isUsPhone(phone)) {
      missing.push({ section: 'details', field: 'phone', message: 'Phone number needs 10 digits' });
    }
    return missing;
  });

  isComplete = computed<boolean>(() => this.missingItems().length === 0);

  firstMissing = computed(() => this.missingItems()[0] ?? null);

  /** Phone bar: when something is missing, take them to it; otherwise place the order. */
  onCheckoutBarTap(): void {
    const missing = this.firstMissing();
    if (missing) {
      this.revealBlockedSection(missing.section);
      return;
    }
    this.checkout();
  }

  sectionNeedsAttention(section: 'subscription' | 'pickup' | 'details'): boolean {
    return this.missingItems().some(item => item.section === section);
  }

  fieldError(field: string): string | null {
    return this.missingItems().find(item => item.field === field)?.message ?? null;
  }

  /** Opens the incomplete section, scrolls to it, and shows the message
   * inline (instead of a greyed-out button). */
  revealBlockedSection(section: 'subscription' | 'pickup' | 'details'): void {
    this.showValidation.set(true);
    if (section === 'details') this.detailsExpanded.set(true);
    if (section === 'subscription') this.bagExpanded.set(true);
    if (typeof window !== 'undefined') {
      setTimeout(() => document.getElementById(`section-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
    }
  }

  /** Same rules as the server: on or after minDate, and Monday/Tuesday for subscriptions. */
  isPickupDateValid = (date: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return false;
    if (date < this.minDate()) return false;
    if (this.closedDates().has(date)) return false;
    if (!this.hasSubscription()) return true;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return weekday === 1 || weekday === 2;
  };

  updateQuantity(item: CartItem, change: number) {
    this.cartService.updateQuantity(item.lineId, item.quantity + change);
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

  removeItem(item: CartItem) {
    this.cartService.removeFromCart(item.lineId);
  }

  toggleSubscription(item: CartItem) {
    this.cartService.toggleSubscription(item.lineId);
  }

  async applyPromo(): Promise<void> {
    const code = this.promoCodeInput().trim();
    if (!code) return;
    const problem = await this.cartService.applyPromoCode(code);
    if (problem) {
      this.modalService.showAlert(problem, 'Promo code', 'warning');
      return;
    }
    this.promoCodeInput.set('');
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

  private buildCheckoutRequest(): CheckoutRequest {
    const isGuest = !this.authService.isAuthenticated();
    const preference = this.getNotificationPreference();
    return {
      lines: this.cartService.checkoutLines(),
      pickupDate: this.pickupDate(),
      promoCode: this.cartService.appliedPromo()?.code,
      attemptKey: this.attemptKey,
      customer: {
        name: (isGuest ? this.guestName() : (this.authService.user()?.name || this.guestName() || 'Customer')).trim(),
        phone: this.guestPhone().trim(),
        email: this.getCustomerEmail().trim(),
        notes: this.notes(),
        notificationPreference: preference === 'NONE' || !preference ? 'EMAIL' : preference
      }
    };
  }

  private serverMessage(err: { status?: number; error?: { error?: string } }, fallback: string): string {
    if (err?.status === 0) return 'We couldn\'t reach the bakery just now. Please check your connection and try again.';
    return err?.error?.error || fallback;
  }

  checkout(): void {
    if (this.submitting()) return;
    const missing = this.firstMissing();
    if (missing) {
      this.revealBlockedSection(missing.section);
      return;
    }
    if (this.cartService.checkoutLines().length !== this.items().length) {
      this.modalService.showAlert('Something in your bag is no longer on the menu. Please remove it and try again.', 'Check your bag', 'warning');
      return;
    }
    this.showValidation.set(false);
    this.submitting.set(true);
    const request = this.buildCheckoutRequest();

    // Pay at pickup: the server prices and saves the order right away.
    // Never for subscriptions: a recurring order needs a card on file.
    if (this.payAtPickup() && !this.hasSubscription()) {
      this.cartService.placePayAtPickupOrder(request).subscribe({
        next: (result) => {
          this.submitting.set(false);
          this.attemptKey = this.newAttemptKey();
          const name = request.customer.name;
          const pickup = this.formatChipDate(request.pickupDate);
          const total = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(result.totalPrice ?? this.totalPrice());
          this.modalService.showAlert(
            `Thank you for your order, ${name}!\n\nConfirmation #${result.orderId}\n\nPickup: ${pickup}\nPay ${total} when you pick it up.`,
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
          this.submitting.set(false);
          logger.error('Pay-at-pickup order failed:', err);
          this.modalService.showAlert(this.serverMessage(err, 'We couldn\'t place your order just now. Please try again in a moment, or give us a call.'), 'Something went wrong', 'error');
        }
      });
      return;
    }

    // Card: the server prices the bag and starts a Stripe Checkout; the order
    // is saved once Stripe confirms the payment.
    this.cartService.createCheckoutSession(request).subscribe({
      next: (session) => {
        if (session.url) {
          window.location.href = session.url; // stays "submitting" while the browser leaves
        } else {
          this.submitting.set(false);
        }
      },
      error: (err) => {
        this.submitting.set(false);
        logger.error('Stripe session creation failed:', err);
        this.modalService.showAlert(this.serverMessage(err, 'We couldn\'t start the card payment. Please try again in a moment.'), 'Payment Error', 'error');
      }
    });
  }

  private newAttemptKey(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 10 digits, or 11 starting with 1 (same as the server's normalizePhone for US numbers). */
function isUsPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

/** YYYY-MM-DD for today in the bakery's timezone. */
function denverToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}

function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
