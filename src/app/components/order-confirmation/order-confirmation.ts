import { Component, OnInit, inject, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { Order } from '../../logic/bakers-math';
import { TenantService } from '../../services/tenant.service';
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
  private tenantService = inject(TenantService);

  orderId = signal<string | null>(null);
  order = signal<Order | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    // Wait for tenant to be identified before fetching order
    effect(() => {
      const tenant = this.tenantService.tenant();
      const id = this.orderId();
      if (tenant && id && !this.order()) {
        this.fetchOrder(id);
      }
    });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('orderId');
    this.orderId.set(id);

    if (!id) {
      this.loading.set(false);
      this.error.set('No order ID found.');
    }
  }

  private retryCount = 0;
  private readonly maxRetries = 6;
  private readonly retryDelayMs = 3000;

  fetchOrder(id: string) {
    this.cartService.getOrderById(id).subscribe({
      next: (data) => {
        logger.debug('[Confirmation Debug] Received Order Data:', data);
        this.order.set(data);
        this.loading.set(false);
        this.cartService.clearCart();
      },
      error: (err) => {
        logger.warn(`[Confirmation] Order fetch attempt ${this.retryCount + 1} failed:`, err?.status);
        if (this.retryCount < this.maxRetries) {
          this.retryCount++;
          setTimeout(() => this.fetchOrder(id), this.retryDelayMs);
        } else {
          console.error('Error fetching order after retries:', err);
          this.loading.set(false);
          this.error.set('We couldn\'t find your order details, but don\'t worry—if you saw the Stripe success page, your order is being processed!');
        }
      }
    });
  }
}
