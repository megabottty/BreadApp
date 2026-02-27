import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-container">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          class="toast toast-{{toast.type}}"
          [attr.role]="toast.type === 'error' ? 'alert' : 'status'"
          [attr.aria-live]="toast.type === 'error' ? 'assertive' : 'polite'"
        >
          <div class="toast-icon">
            @switch (toast.type) {
              @case ('success') { ✓ }
              @case ('error') { ✕ }
              @case ('warning') { ⚠ }
              @case ('info') { ℹ }
            }
          </div>
          <div class="toast-message">{{ toast.message }}</div>
          <button
            class="toast-close"
            (click)="toastService.dismiss(toast.id)"
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-width: 400px;
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      background: white;
      pointer-events: auto;
      animation: slideIn 0.3s ease-out;
      min-width: 300px;
      border-left: 4px solid;
    }

    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    .toast-icon {
      font-size: 20px;
      font-weight: bold;
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }

    .toast-message {
      flex: 1;
      font-size: 14px;
      line-height: 1.4;
      color: #333;
    }

    .toast-close {
      background: none;
      border: none;
      font-size: 24px;
      line-height: 1;
      cursor: pointer;
      color: #999;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color 0.2s;
    }

    .toast-close:hover {
      color: #333;
    }

    .toast-success {
      border-left-color: #28a745;
    }

    .toast-success .toast-icon {
      color: #28a745;
      background: #d4edda;
    }

    .toast-error {
      border-left-color: #dc3545;
    }

    .toast-error .toast-icon {
      color: #dc3545;
      background: #f8d7da;
    }

    .toast-warning {
      border-left-color: #ffc107;
    }

    .toast-warning .toast-icon {
      color: #856404;
      background: #fff3cd;
    }

    .toast-info {
      border-left-color: #17a2b8;
    }

    .toast-info .toast-icon {
      color: #17a2b8;
      background: #d1ecf1;
    }

    @media (max-width: 768px) {
      .toast-container {
        left: 20px;
        right: 20px;
        bottom: 80px;
        max-width: none;
      }

      .toast {
        min-width: auto;
      }
    }
  `]
})
export class ToastContainerComponent {
  toastService = inject(ToastService);
}
