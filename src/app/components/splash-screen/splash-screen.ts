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
  private maxVisibleMs = 8000; // Increased to 8s for reliability

  private router = inject(Router);
  private appLoadService = inject(AppLoadService);

  private messages = [
    'Feeding the starter...',
    'Kneading the dough...',
    'Waiting for the first rise...',
    'Dusting with flour...',
    'Scoring the loaves...'
  ];

  ngOnInit() {
    const isE2E = typeof window !== 'undefined' && window.location.search.includes('e2e=1');
    if (isE2E) {
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
      }
    };

    // Use requestAnimationFrame or a small timeout to ensure we don't block initial paint
    setTimeout(updateMessage, 100);

    this.isStorefrontRoute.set(
      this.router.url === '/' || this.router.url.startsWith('/front') || this.router.url.startsWith('/b/')
    );

    if (this.isStorefrontRoute()) {
      setTimeout(() => {
        if (this.isVisible()) {
          console.warn('[SplashScreen] Max visible time reached, forcing hide.');
          this.hide();
        }
      }, this.maxVisibleMs);
    }

    effect(() => {
      if (!this.isVisible()) return;

      const isReady = this.appLoadService.storefrontReady();
      if (this.animationDone() && (isReady || !this.isStorefrontRoute())) {
        this.hide();
      }
    });
  }

  private hide() {
    this.isOverlayVisible.set(false);
    // Wait for CSS transition (0.5s) before removing from DOM
    setTimeout(() => {
      this.isVisible.set(false);
    }, 500);
  }
}
