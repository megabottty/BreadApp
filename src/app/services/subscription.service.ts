import { Injectable, signal, computed, inject } from '@angular/core';
import { CalculatedRecipe } from '../logic/bakers-math';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TenantService } from './tenant.service';

import { environment } from '../../environments/environment';

export interface Subscription {
  id: string;
  customerId: string;
  recipeId: string;
  recipeName: string;
  quantity: number;
  frequency: 'WEEKLY';
  price: number;
  startDate: string;
  nextBakeDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED';
}

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);
  private apiUrl = environment.apiUrl + '/orders/subscriptions';
  private subscriptions = signal<Subscription[]>([]);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  allSubscriptions = computed(() => this.subscriptions());

  constructor() {
    this.loadSubscriptionsFromLocalStorage();
  }

  private loadSubscriptionsFromLocalStorage() {
    const saved = localStorage.getItem('bakery_subscriptions');
    if (saved) {
      try {
        this.subscriptions.set(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading subscriptions from localStorage', e);
      }
    }
  }

  fetchSubscriptionsForUser(customerId: string) {
    this.http.get<any[]>(`${this.apiUrl}/${customerId}`, { headers: this.headers }).subscribe({
      next: (data) => {
        const mapped: Subscription[] = data.map(s => ({
          id: s.id,
          customerId: s.customer_id,
          recipeId: s.recipe_id,
          recipeName: s.recipe_name,
          quantity: s.quantity,
          frequency: s.frequency,
          price: s.price,
          startDate: s.start_date,
          nextBakeDate: s.next_bake_date,
          status: s.status
        }));
        this.subscriptions.set(mapped);
        try {
          localStorage.setItem('bakery_subscriptions', JSON.stringify(mapped));
        } catch (e) {
          console.warn('Failed to save subscriptions to localStorage (quota exceeded)', e);
        }
      },
      error: (err) => console.error('Error fetching subscriptions', err)
    });
  }

  getSubscriptionsForUser(customerId: string) {
    return computed(() => this.subscriptions().filter(s => s.customerId === customerId));
  }

  private saveSubscriptions() {
    try {
      localStorage.setItem('bakery_subscriptions', JSON.stringify(this.subscriptions()));
    } catch (e) {
      console.warn('Failed to save subscriptions to localStorage (quota exceeded)', e);
    }
  }

  createSubscription(customerId: string, product: CalculatedRecipe, quantity: number) {
    const nextMonday = this.getNextMonday();
    const newSub: any = {
      customerId,
      recipeId: product.id || '',
      recipeName: product.name,
      quantity,
      frequency: 'WEEKLY',
      price: product.price || 12,
      startDate: new Date().toISOString().split('T')[0],
      nextBakeDate: nextMonday.toISOString().split('T')[0],
      status: 'ACTIVE'
    };

    this.http.post<any>(this.apiUrl, newSub, { headers: this.headers }).subscribe({
      next: (saved) => {
        const formatted: Subscription = {
          id: saved.id,
          customerId: saved.customer_id,
          recipeId: saved.recipe_id,
          recipeName: saved.recipe_name,
          quantity: saved.quantity,
          frequency: saved.frequency,
          price: saved.price,
          startDate: saved.start_date,
          nextBakeDate: saved.next_bake_date,
          status: saved.status
        };
        this.subscriptions.update(prev => [...prev, formatted]);
        this.saveSubscriptions();
      },
      error: (err) => {
        console.error('Failed to create subscription in DB, saving locally', err);
        const localSub = { ...newSub, id: 'LOCAL_' + Math.random().toString(36).substring(7) };
        this.subscriptions.update(prev => [...prev, localSub]);
        this.saveSubscriptions();
      }
    });
  }

  cancelSubscription(subId: string) {
    this.updateSubscriptionStatus(subId, 'CANCELLED');
  }

  pauseSubscription(subId: string) {
    this.updateSubscriptionStatus(subId, 'PAUSED');
  }

  resumeSubscription(subId: string) {
    this.updateSubscriptionStatus(subId, 'ACTIVE');
  }

  private updateSubscriptionStatus(subId: string, status: 'ACTIVE' | 'PAUSED' | 'CANCELLED') {
    this.http.patch<any>(`${this.apiUrl}/${subId}/status`, { status }, { headers: this.headers }).subscribe({
      next: () => {
        this.subscriptions.update(prev => prev.map(s =>
          s.id === subId ? { ...s, status } : s
        ));
        this.saveSubscriptions();
      },
      error: (err) => {
        console.error('Failed to update subscription status in DB, updating locally', err);
        this.subscriptions.update(prev => prev.map(s =>
          s.id === subId ? { ...s, status } : s
        ));
        this.saveSubscriptions();
      }
    });
  }

  private getNextMonday(): Date {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return d;
  }
}
