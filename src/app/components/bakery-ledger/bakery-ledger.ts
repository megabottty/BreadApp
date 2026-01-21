import { Component, OnInit, signal, computed, inject, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Order, PromoCode } from '../../logic/bakers-math';
import { FormsModule } from '@angular/forms';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-bakery-ledger',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule],
  templateUrl: './bakery-ledger.html',
  styleUrls: ['./bakery-ledger.css']
})
export class BakeryLedgerComponent implements OnInit {
  private http = inject(HttpClient);
  private modalService = inject(ModalService);

  allOrders = signal<Order[]>([]);
  searchTerm = signal<string>('');
  statusFilter = signal<string>('ALL');

  // Promo management
  availablePromos = signal<PromoCode[]>([]);
  showPromoManager = signal(false);

  // New promo form
  newPromo = signal<Partial<PromoCode>>({
    code: '',
    type: 'FIXED',
    value: 5,
    description: '',
    isActive: true
  });

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

  private tenantService = inject(TenantService);

  private headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  constructor() {
    // React to tenant changes to reload data
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        console.log('[BakeryLedger] Tenant identified, loading orders and promos:', tenant.slug);
        this.loadOrders();
        this.loadPromos();
      }
    });
  }

  ngOnInit() {
  }

  loadOrders() {
    this.http.get<Order[]>('http://localhost:3000/api/orders', { headers: this.headers() }).subscribe({
      next: (orders) => this.allOrders.set(orders),
      error: (err) => console.error('Failed to load ledger orders:', err)
    });
  }

  loadPromos() {
    this.http.get<any[]>('http://localhost:3000/api/orders/promos/all', { headers: this.headers() }).subscribe({
      next: (data) => {
        const mapped: PromoCode[] = data.map(p => ({
          id: p.id,
          code: p.code,
          type: p.type,
          value: p.value,
          description: p.description,
          isActive: p.is_active,
          usageCount: this.allOrders().filter(o => o.promoCode === p.code).length
        }));
        this.availablePromos.set(mapped);
      },
      error: (err) => console.error('Failed to load promos', err)
    });
  }

  savePromo() {
    const promo = this.newPromo();
    if (!promo.code) return;

    this.http.post('http://localhost:3000/api/orders/promos', promo, { headers: this.headers() }).subscribe({
      next: () => {
        this.loadPromos();
        this.newPromo.set({ code: '', type: 'FIXED', value: 5, description: '', isActive: true });
        this.modalService.showAlert('Promo code saved! 🎟️', 'Success', 'success');
      }
    });
  }

  deletePromo(id: string) {
    if (confirm('Are you sure you want to delete this promo code?')) {
      this.http.delete(`http://localhost:3000/api/orders/promos/${id}`, { headers: this.headers() }).subscribe({
        next: () => this.loadPromos()
      });
    }
  }

  getStatusClass(status: string): string {
    return `status-badge ${status.toLowerCase()}`;
  }
}
