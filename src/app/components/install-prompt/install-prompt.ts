import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PwaService } from '../../services/pwa.service';

@Component({
  selector: 'app-install-prompt',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (pwaService.showInstallPrompt()) {
      <div class="install-banner">
        <div class="banner-content">
          <div class="app-icon">🥖</div>
          <div class="app-info">
            <strong>Install The Daily Dough</strong>
            <p>{{ pwaService.isIos() ? 'Add to home screen for the best experience' : 'Fast access from your home screen' }}</p>
          </div>

          @if (pwaService.isIos()) {
            <div class="ios-instructions">
              <span class="instruction-text">Tap the Share icon <span class="icon">⎋</span> then "Add to Home Screen"</span>
            </div>
          } @else {
            <button class="btn-install" (click)="pwaService.installApp()">Install</button>
          }

          <button class="btn-close" (click)="pwaService.closePrompt()">×</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .install-banner {
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.15);
      z-index: 9999;
      padding: 1rem;
      border: 1px solid #E9E5D9;
      animation: slideUp 0.5s ease-out;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    }

    @keyframes slideUp {
      from { transform: translateY(100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .banner-content {
      display: flex;
      align-items: center;
      gap: 1rem;
      position: relative;
    }

    .app-icon {
      font-size: 2rem;
      background: #F1F3EB;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      flex-shrink: 0;
    }

    .app-info {
      flex-grow: 1;
    }

    .app-info strong {
      display: block;
      font-size: 1rem;
      color: #5F6F52;
    }

    .app-info p {
      margin: 0;
      font-size: 0.8rem;
      color: #8C967D;
    }

    .btn-install {
      background: #7D8F69;
      color: white;
      border: none;
      padding: 0.5rem 1.25rem;
      border-radius: 20px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
    }

    .ios-instructions {
      background: #F8F7F2;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      border: 1px dashed #7D8F69;
    }

    .instruction-text {
      font-size: 0.75rem;
      color: #5F6F52;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .icon {
      font-size: 1.2rem;
      color: #007AFF; /* Apple Blue */
    }

    .btn-close {
      position: absolute;
      top: -0.5rem;
      right: -0.5rem;
      background: #E5E0D5;
      border: none;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #8C8273;
      font-size: 1rem;
    }

    @media (min-width: 768px) {
      .install-banner {
        max-width: 400px;
        left: auto;
        right: 30px;
        bottom: 30px;
      }
    }
  `]
})
export class InstallPromptComponent {
  pwaService = inject(PwaService);
}
