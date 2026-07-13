import { Component, signal, OnInit, ChangeDetectionStrategy, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AppLoadService } from '../../services/app-load.service';

@Component({
  selector: 'app-splash-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './splash-screen.html',
  styleUrls: ['./splash-screen.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SplashScreenComponent implements OnInit {
  isVisible = signal(true);
  isOverlayVisible = signal(true);
  message = signal('Preheating the oven...');
  animationDone = signal(false);
  isStorefrontRoute = signal(true);
  isMaintenanceMode = signal(false); // Control flag for persistent splash
  private maxVisibleMs = 8000;

  private router = inject(Router);
  private appLoadService = inject(AppLoadService);

  private messages = [
    'Feeding the starter...',
    'Kneading the dough...',
    'Waiting for the first rise...',
    'Dusting with flour...',
    'Scoring the loaves...'
  ];

  constructor() {
    effect(() => {
      if (!this.isVisible() || this.isMaintenanceMode()) return;

      const isReady = this.appLoadService.storefrontReady();
      if (this.animationDone() && (isReady || !this.isStorefrontRoute())) {
        this.hide();
      }
    });
  }

  ngOnInit() {
    const isE2E = typeof window !== 'undefined' && window.location.search.includes('e2e=1');
    const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1');

    if (isE2E || isDebug) {
      this.isVisible.set(false);
      this.isOverlayVisible.set(false);
      return;
    }

    let count = 0;
    const updateMessage = () => {
      if (count < this.messages.length) {
        this.message.set(this.messages[count]);
        count++;
        setTimeout(updateMessage, 600);
      } else {
        this.animationDone.set(true);
        if (this.isMaintenanceMode()) {
          this.message.set('Putting the finishing touches on...');
        }
      }
    };

    // Use requestAnimationFrame or a small timeout to ensure we don't block initial paint
    setTimeout(updateMessage, 100);

    this.isStorefrontRoute.set(
      this.router.url === '/' ||
      this.router.url.startsWith('/front') ||
      this.router.url.startsWith('/under-construction') ||
      this.router.url.startsWith('/b/')
    );

    if (this.isStorefrontRoute() && !this.isMaintenanceMode()) {
      setTimeout(() => {
        if (this.isVisible()) {
          console.warn('[SplashScreen] Max visible time reached, forcing hide.');
          this.hide();
        }
      }, this.maxVisibleMs);
    }
  }

  private hide() {
    this.isOverlayVisible.set(false);
    // Wait for CSS transition (0.5s) before removing from DOM
    setTimeout(() => {
      this.isVisible.set(false);
    }, 500);
  }
}
