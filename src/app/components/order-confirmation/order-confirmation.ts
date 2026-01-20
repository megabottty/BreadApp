import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { Order } from '../../logic/bakers-math';

@Component({
  selector: 'app-order-confirmation',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './order-confirmation.html',
  styleUrls: ['./order-confirmation.css']
})
export class OrderConfirmationComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private cartService = inject(CartService);

  orderId = signal<string | null>(null);
  order = signal<Order | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('orderId');
    this.orderId.set(id);

    if (id) {
      this.fetchOrder(id);
    } else {
      this.loading.set(false);
      this.error.set('No order ID found.');
    }
  }

  fetchOrder(id: string) {
    this.cartService.getOrderById(id).subscribe({
      next: (data) => {
        console.log('[Confirmation Debug] Received Order Data:', data);
        this.order.set(data);
        this.loading.set(false);
        // Clear cart now that we've confirmed the order
        this.cartService.clearCart();
      },
      error: (err) => {
        console.error('Error fetching order:', err);
        this.loading.set(false);
        this.error.set('We couldn\'t find your order details, but don\'t worry—if you saw the Stripe success page, your order is being processed!');
      }
    });
  }
}
