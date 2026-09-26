import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';
import { TenantService } from './tenant.service';

import { environment } from '../../environments/environment';

export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

export interface Subscription {
  id: string;
  customerId: string;
  recipeId: string;
  recipeName: string;
  quantity: number;
  frequency: 'WEEKLY';
  price: number;
  startDate: string;
  /** Next pickup day (YYYY-MM-DD). */
  nextBakeDate: string;
  status: SubscriptionStatus;
  /** Pickup days the customer skipped (YYYY-MM-DD). */
  skippedDates: string[];
  /** 1 = Monday, 2 = Tuesday. */
  pickupWeekday?: number;
  customerPhone?: string | null;
  lastReply?: string | null;
}

/** Row shape returned by the server (snake_case). */
export interface SubscriptionRow {
  id: string | number;
  customer_id: string;
  recipe_id: string | null;
  recipe_name: string;
  quantity: number;
  frequency: 'WEEKLY';
  price: number | string;
  start_date: string;
  next_bake_date: string;
  status: SubscriptionStatus;
  skipped_dates?: string[] | null;
  pickup_weekday?: number | null;
  customer_phone?: string | null;
  last_reply?: string | null;
}

type SubscriptionProduct = {
  id?: string;
  name: string;
  price?: number;
};

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);
  private apiUrl = environment.apiUrl + '/orders/subscriptions';
  private subscriptions = signal<Subscription[]>([]);

  private get headers(): HttpHeaders {
    const slug = this.tenantService.tenant()?.slug || 'thedailydough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  allSubscriptions = computed(() => this.subscriptions());

  /** snake_case server row -> Subscription. The one place this mapping lives. */
  mapRow(row: SubscriptionRow): Subscription {
    return {
      id: String(row.id),
      customerId: row.customer_id,
      recipeId: row.recipe_id || '',
      recipeName: row.recipe_name,
      quantity: row.quantity,
      frequency: row.frequency || 'WEEKLY',
      price: Number(row.price),
      startDate: row.start_date,
      nextBakeDate: row.next_bake_date,
      status: row.status,
      skippedDates: Array.isArray(row.skipped_dates) ? row.skipped_dates : [],
      pickupWeekday: row.pickup_weekday ?? undefined,
      customerPhone: row.customer_phone ?? null,
      lastReply: row.last_reply ?? null
    };
  }

  fetchSubscriptionsForUser(customerId: string): void {
    this.http.get<SubscriptionRow[]>(`${this.apiUrl}/${customerId}`, { headers: this.headers }).subscribe({
      next: (data) => {
        const mapped = data.map(row => this.mapRow(row));
        this.subscriptions.set(mapped);
        this.saveSubscriptions();
      },
      error: (err) => console.error('Error fetching subscriptions', err)
    });
  }

  getSubscriptionsForUser(customerId: string) {
    return computed(() => this.subscriptions().filter(s => s.customerId === customerId));
  }

  private saveSubscriptions(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem('bakery_subscriptions', JSON.stringify(this.subscriptions()));
    } catch (e) {
      console.warn('Failed to save subscriptions to localStorage (quota exceeded)', e);
    }
  }

  createSubscription(customerId: string, product: SubscriptionProduct, quantity: number): void {
    const nextMonday = this.getNextMonday();
    const newSub = {
      customerId,
      recipeId: product.id || '',
      recipeName: product.name,
      quantity,
      frequency: 'WEEKLY' as const,
      price: product.price || 12,
      startDate: new Date().toISOString().split('T')[0],
      nextBakeDate: nextMonday.toISOString().split('T')[0],
      status: 'ACTIVE' as const
    };

    this.http.post<SubscriptionRow>(this.apiUrl, newSub, { headers: this.headers }).subscribe({
      next: (saved) => {
        this.subscriptions.update(prev => [...prev, this.mapRow(saved)]);
        this.saveSubscriptions();
      },
      error: (err) => {
        console.error('Failed to create subscription in DB, saving locally', err);
        const localSub: Subscription = { ...newSub, id: 'LOCAL_' + Math.random().toString(36).substring(7), skippedDates: [] };
        this.subscriptions.update(prev => [...prev, localSub]);
        this.saveSubscriptions();
      }
    });
  }

  cancelSubscription(subId: string): Observable<Subscription> {
    return this.updateSubscriptionStatus(subId, 'CANCELLED');
  }

  pauseSubscription(subId: string): Observable<Subscription> {
    return this.updateSubscriptionStatus(subId, 'PAUSED');
  }

  resumeSubscription(subId: string): Observable<Subscription> {
    return this.updateSubscriptionStatus(subId, 'ACTIVE');
  }

  /** Skip the upcoming pickup; the server moves the next date a week out
   * and credits that week's price on the next payment. */
  skipNextWeek(subId: string): Observable<Subscription> {
    return this.postAndReplace(`${this.apiUrl}/${subId}/skip`);
  }

  /** Reverse the most recent skip (only while that pickup is still ahead). */
  undoSkip(subId: string): Observable<Subscription> {
    return this.postAndReplace(`${this.apiUrl}/${subId}/unskip`);
  }

  /** True when the latest skipped pickup hasn't happened yet, so "Undo skip" makes sense. */
  upcomingSkipped(sub: Subscription): string | null {
    if (!sub.skippedDates.length) return null;
    const latest = [...sub.skippedDates].sort().at(-1) as string;
    const today = new Date().toISOString().slice(0, 10);
    return latest >= today ? latest : null;
  }

  private postAndReplace(url: string): Observable<Subscription> {
    return this.http.post<SubscriptionRow>(url, {}, { headers: this.headers }).pipe(
      map(row => this.mapRow(row)),
      tap(updated => this.replaceLocal(updated))
    );
  }

  private updateSubscriptionStatus(subId: string, status: SubscriptionStatus): Observable<Subscription> {
    // Only reflect the change once the server confirms it; a failed request
    // used to flip the card locally and mislead the customer.
    return this.http.patch<SubscriptionRow | null>(`${this.apiUrl}/${subId}/status`, { status }, { headers: this.headers }).pipe(
      map(row => (row && row.id !== undefined ? this.mapRow(row) : this.withStatus(subId, status))),
      tap({
        next: (updated) => this.replaceLocal(updated),
        error: (err) => console.error('Failed to update subscription status', err)
      })
    );
  }

  private withStatus(subId: string, status: SubscriptionStatus): Subscription {
    const existing = this.subscriptions().find(s => s.id === subId);
    return { ...(existing as Subscription), status };
  }

  private replaceLocal(updated: Subscription): void {
    this.subscriptions.update(prev => prev.some(s => s.id === updated.id)
      ? prev.map(s => (s.id === updated.id ? updated : s))
      : [...prev, updated]);
    this.saveSubscriptions();
  }

  private getNextMonday(): Date {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return d;
  }
}
