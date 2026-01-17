import { Injectable, signal, computed, inject } from '@angular/core';
import { CalculatedRecipe } from '../logic/bakers-math';

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
  private subscriptions = signal<Subscription[]>([]);

  allSubscriptions = computed(() => this.subscriptions());

  constructor() {
    this.loadSubscriptions();
  }

  private loadSubscriptions() {
    const saved = localStorage.getItem('bakery_subscriptions');
    if (saved) {
      try {
        this.subscriptions.set(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading subscriptions', e);
      }
    }
  }

  private saveSubscriptions() {
    localStorage.setItem('bakery_subscriptions', JSON.stringify(this.subscriptions()));
  }

  getSubscriptionsForUser(customerId: string) {
    return computed(() => this.subscriptions().filter(s => s.customerId === customerId));
  }

  createSubscription(customerId: string, product: CalculatedRecipe, quantity: number) {
    const nextMonday = this.getNextMonday();
    const newSub: Subscription = {
      id: Math.random().toString(36).substring(7).toUpperCase(),
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

    this.subscriptions.update(prev => [...prev, newSub]);
    this.saveSubscriptions();
    return newSub;
  }

  cancelSubscription(subId: string) {
    this.subscriptions.update(prev => prev.map(s =>
      s.id === subId ? { ...s, status: 'CANCELLED' as const } : s
    ));
    this.saveSubscriptions();
  }

  pauseSubscription(subId: string) {
    this.subscriptions.update(prev => prev.map(s =>
      s.id === subId ? { ...s, status: 'PAUSED' as const } : s
    ));
    this.saveSubscriptions();
  }

  resumeSubscription(subId: string) {
    this.subscriptions.update(prev => prev.map(s =>
      s.id === subId ? { ...s, status: 'ACTIVE' as const } : s
    ));
    this.saveSubscriptions();
  }

  private getNextMonday(): Date {
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return d;
  }
}
