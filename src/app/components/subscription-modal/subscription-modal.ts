import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-subscription-modal',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="subscription-modal-overlay" (click)="close.emit()" role="dialog" aria-modal="true" aria-labelledby="sub-info-title">
      <div class="subscription-info-card card" (click)="$event.stopPropagation()">
        <button class="btn-close-modal" (click)="close.emit()" aria-label="Close modal">×</button>

        <header class="modal-header-pro">
          <div class="icon-circle" aria-hidden="true">🔄</div>
          <h2 id="sub-info-title">Artisan Bread Subscriptions</h2>
          <p class="tagline">The freshest way to enjoy your daily bread, automated.</p>
        </header>

        <div class="benefit-grid">
          <div class="benefit-item">
            <span class="benefit-icon" aria-hidden="true">📅</span>
            <div class="benefit-content">
              <h4>Weekly Delivery</h4>
              <p>Your favorites are automatically prioritized in our bake schedule every week.</p>
            </div>
          </div>

          <div class="benefit-item">
            <span class="benefit-icon" aria-hidden="true">🌿</span>
            <div class="benefit-content">
              <h4>Peak Freshness</h4>
              <p>Dispatched every Monday & Tuesday. Hand-delivered or shipped within hours of leaving the oven.</p>
            </div>
          </div>

          <div class="benefit-item">
            <span class="benefit-icon" aria-hidden="true">⚙️</span>
            <div class="benefit-content">
              <h4>Total Control</h4>
              <p>Pause, skip, or cancel anytime. Manage your subscription directly from your profile.</p>
            </div>
          </div>

          <div class="benefit-item">
            <span class="benefit-icon" aria-hidden="true">✨</span>
            <div class="benefit-content">
              <h4>No Extra Cost</h4>
              <p>Standard product pricing. No hidden membership fees or recurring surcharges.</p>
            </div>
          </div>
        </div>

        <footer class="modal-footer-pro">
          <p>Ready to start? Simply look for the <strong>Subscribe</strong> button on any product!</p>
          <button class="btn-primary" (click)="close.emit()">Got it, thanks!</button>
        </footer>
      </div>
    </div>
  `,
  styleUrls: ['./subscription-modal.css']
})
export class SubscriptionModalComponent {
  @Output() close = new EventEmitter<void>();
}
