import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Order } from '../../logic/bakers-math';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-bakery-ledger',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
  templateUrl: './bakery-ledger.html',
  styleUrls: ['./bakery-ledger.css']
})
export class BakeryLedgerComponent implements OnInit {
  private http = inject(HttpClient);

  allOrders = signal<Order[]>([]);
  searchTerm = signal<string>('');
  statusFilter = signal<string>('ALL');

  // Statistics
  stats = computed(() => {
    const orders = this.allOrders();
    const completedOrders = orders.filter(o => o.status === 'COMPLETED');

    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
    const pendingRevenue = orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED')
                                 .reduce((sum, o) => sum + (o.totalPrice || 0), 0);

    return {
      totalOrders: orders.length,
      completedCount: completedOrders.length,
      totalRevenue,
      pendingRevenue,
      averageOrderValue: completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0
    };
  });

  filteredOrders = computed(() => {
    let orders = this.allOrders();
    const search = this.searchTerm().toLowerCase();
    const status = this.statusFilter();

    if (status !== 'ALL') {
      orders = orders.filter(o => o.status === status);
    }

    if (search) {
      orders = orders.filter(o =>
        o.customerName.toLowerCase().includes(search) ||
        o.id.toLowerCase().includes(search)
      );
    }

    return orders;
  });

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.http.get<Order[]>('http://localhost:3000/api/orders').subscribe({
      next: (orders) => this.allOrders.set(orders),
      error: (err) => console.error('Failed to load ledger orders:', err)
    });
  }

  getStatusClass(status: string): string {
    return `status-badge ${status.toLowerCase()}`;
  }
}
