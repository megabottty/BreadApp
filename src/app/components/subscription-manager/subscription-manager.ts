import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Subscription, SubscriptionService } from '../../services/subscription.service';
import { AuthService } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
import { ToastService } from '../../services/toast.service';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-subscription-manager',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink],
  templateUrl: './subscription-manager.html',
  styleUrls: ['./subscription-manager.css']
})
export class SubscriptionManagerComponent implements OnInit {
  subscriptionService = inject(SubscriptionService);
  authService = inject(AuthService);
  modalService = inject(ModalService);
  private readonly toastService = inject(ToastService);

  selectedTab = signal<'active' | 'inactive'>('active');
  /** Subscription id with a request in flight, to disable its buttons. */
  busyId = signal<string | null>(null);

  userSubscriptions = computed(() => {
    const user = this.authService.user();
    if (!user) return [];
    return this.subscriptionService.getSubscriptionsForUser(user.id)();
  });

  filteredSubscriptions = computed(() => {
    const subs = this.userSubscriptions();
    const tab = this.selectedTab();
    if (tab === 'active') {
      return subs.filter(s => s.status === 'ACTIVE');
    } else {
      return subs.filter(s => s.status === 'PAUSED' || s.status === 'CANCELLED');
    }
  });

  ngOnInit(): void {
    const user = this.authService.user();
    if (user) {
      this.subscriptionService.fetchSubscriptionsForUser(user.id);
    }
  }

  /** The skipped pickup that is still ahead of us, if any (drives "Undo skip"). */
  upcomingSkipped(sub: Subscription): string | null {
    return this.subscriptionService.upcomingSkipped(sub);
  }

  skipNextWeek(sub: Subscription): void {
    const when = this.formatDay(sub.nextBakeDate);
    this.modalService.showConfirm(
      `Skip your ${sub.recipeName} pickup on ${when}? You won't be charged for that week; it's credited on your next payment. Your subscription continues the week after.`,
      'Skip a week',
      () => this.run(sub.id, this.subscriptionService.skipNextWeek(sub.id), (updated) => `Skipped ${when}. Your next pickup is ${this.formatDay(updated.nextBakeDate)}.`),
      undefined,
      'Skip this week',
      'Keep it'
    );
  }

  undoSkip(sub: Subscription): void {
    this.run(sub.id, this.subscriptionService.undoSkip(sub.id), (updated) => `Skip undone. Your next pickup is ${this.formatDay(updated.nextBakeDate)}.`);
  }

  pauseSubscription(sub: Subscription): void {
    this.modalService.showConfirm(
      `Pause ${sub.recipeName}? No more weekly pickups or charges until you resume.`,
      'Pause subscription',
      () => this.run(sub.id, this.subscriptionService.pauseSubscription(sub.id), () => 'Your subscription is paused. Resume whenever you like.'),
      undefined,
      'Pause',
      'Keep it going'
    );
  }

  resumeSubscription(sub: Subscription): void {
    this.run(sub.id, this.subscriptionService.resumeSubscription(sub.id), () => 'Welcome back! Your subscription is active again.');
  }

  cancelSubscription(sub: Subscription): void {
    this.modalService.showConfirm(
      `Cancel ${sub.recipeName} for good? You can always subscribe again from the storefront.`,
      'Cancel subscription',
      () => this.run(sub.id, this.subscriptionService.cancelSubscription(sub.id), () => 'Your subscription has been cancelled.'),
      undefined,
      'Cancel subscription',
      'Keep it'
    );
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'ACTIVE': return '✅';
      case 'PAUSED': return '⏸️';
      case 'CANCELLED': return '❌';
      default: return '❓';
    }
  }

  formatDay(isoDate: string): string {
    if (!isoDate) return '';
    return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  private run(id: string, request: import('rxjs').Observable<Subscription>, successMessage: (updated: Subscription) => string): void {
    this.busyId.set(id);
    request.subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.toastService.success(successMessage(updated), 5000);
      },
      error: (err: { error?: { error?: string } }) => {
        this.busyId.set(null);
        this.toastService.error(err?.error?.error || 'That didn\'t go through. Please try again.');
      }
    });
  }
}
