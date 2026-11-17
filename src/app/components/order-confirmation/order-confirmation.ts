import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { Order } from '../../logic/bakers-math';
import { logger } from '../../utils/logger';

@Component({
  selector: 'app-order-confirmation',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './order-confirmation.html',
  styleUrls: ['./order-confirmation.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderConfirmationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private cartService = inject(CartService);

  orderId = signal<string | null>(null);
  order = signal<Order | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  private sessionId: string | null = null;
  private retryCount = 0;
  private readonly maxRetries = 6;
  private readonly retryDelayMs = 3000;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('orderId');
    this.sessionId = this.route.snapshot.queryParamMap.get('session_id');
    this.orderId.set(id);

    if (!id || !this.sessionId) {
      this.loading.set(false);
      this.error.set('We couldn\'t find that order. If you were charged, check your email for a receipt from Stripe, or contact us.');
      return;
    }
    this.checkStatus(id, this.sessionId);
  }

  /** Asks the server whether Stripe has the payment. The server saves the
   * order itself if the webhook hasn't yet, so this rarely needs a retry. */
  private checkStatus(id: string, sessionId: string): void {
    this.cartService.getCheckoutStatus(id, sessionId).subscribe({
      next: (status) => {
        if (status.paid) {
          // Paid: the bag is done with, whether or not the order details load.
          this.cartService.clearCart();
          if (status.order) {
            this.order.set(status.order);
            this.loading.set(false);
            return;
          }
        }
        this.retryOrGiveUp(id, sessionId, status.paid);
      },
      error: (err: { status?: number }) => {
        logger.warn(`[Confirmation] Status check ${this.retryCount + 1} failed:`, err?.status);
        this.retryOrGiveUp(id, sessionId, false);
      }
    });
  }

  private retryOrGiveUp(id: string, sessionId: string, paid: boolean): void {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      setTimeout(() => this.checkStatus(id, sessionId), this.retryDelayMs);
      return;
    }
    this.loading.set(false);
    this.error.set(paid
      ? `Your payment went through (order #${id}), but we couldn't load the details just now. You'll get a confirmation shortly.`
      : 'We haven\'t received the payment confirmation yet. If you were charged, you\'ll get a confirmation shortly. Otherwise, your bag is still saved.');
  }
}
