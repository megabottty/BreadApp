import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { SubscriptionService, Subscription } from '../../services/subscription.service';
import { AuthService } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
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

  userSubscriptions = computed(() => {
    const user = this.authService.user();
    if (!user) return [];
    return this.subscriptionService.getSubscriptionsForUser(user.id)();
  });

  ngOnInit() {
    const user = this.authService.user();
    if (user) {
      this.subscriptionService.fetchSubscriptionsForUser(user.id);
    }
  }

  pauseSubscription(id: string) {
    this.subscriptionService.pauseSubscription(id);
    this.modalService.showAlert('Your subscription has been paused.', 'Subscription Paused', 'info');
  }

  resumeSubscription(id: string) {
    this.subscriptionService.resumeSubscription(id);
    this.modalService.showAlert('Your subscription is now active again!', 'Subscription Resumed', 'success');
  }

  cancelSubscription(id: string) {
    if (confirm('Are you sure you want to cancel this subscription? You will lose your guaranteed weekly bake slot.')) {
      this.subscriptionService.cancelSubscription(id);
      this.modalService.showAlert('Your subscription has been cancelled.', 'Subscription Cancelled', 'warning');
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'ACTIVE': return '✅';
      case 'PAUSED': return '⏸️';
      case 'CANCELLED': return '❌';
      default: return '❓';
    }
  }
}
