import { Injectable, signal, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private platformId = inject(PLATFORM_ID);

  showInstallPrompt = signal(false);
  deferredPrompt: any = null;
  isIos = signal(false);
  isInStandaloneMode = signal(false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initPwa();
    }
  }

  private initPwa() {
    // Detect iOS
    const ua = window.navigator.userAgent;
    this.isIos.set(/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream);

    // Detect if already in standalone mode
    this.isInStandaloneMode.set(
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        console.log('[PWA] Service Worker registered:', reg.scope);
      }).catch(err => {
        console.error('[PWA] Service Worker registration failed:', err);
      });
    }

    // Capture the beforeinstallprompt event (Chrome/Android)
    window.addEventListener('beforeinstallprompt', (e) => {
      console.log('[PWA] beforeinstallprompt event fired');
      e.preventDefault();
      this.deferredPrompt = e;

      // Don't show immediately, maybe wait a few seconds or show based on logic
      setTimeout(() => {
        if (!this.isInStandaloneMode()) {
           this.showInstallPrompt.set(true);
        }
      }, 5000);
    });

    // For iOS, we can't capture an event, so we show it after some time
    // But only if they haven't seen it in this session
    const hasSeenPrompt = sessionStorage.getItem('pwa_prompt_shown');
    if (this.isIos() && !this.isInStandaloneMode() && !hasSeenPrompt) {
      setTimeout(() => {
        this.showInstallPrompt.set(true);
        sessionStorage.setItem('pwa_prompt_shown', 'true');
      }, 3000); // Reduced to 3 seconds for better discoverability
    }
  }

  installApp() {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choiceResult: any) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('[PWA] User accepted the install prompt');
        } else {
          console.log('[PWA] User dismissed the install prompt');
          sessionStorage.setItem('pwa_prompt_shown', 'true');
        }
        this.deferredPrompt = null;
        this.showInstallPrompt.set(false);
      });
    }
  }

  closePrompt() {
    this.showInstallPrompt.set(false);
    sessionStorage.setItem('pwa_prompt_shown', 'true');
  }
}
