import { Injectable } from '@angular/core';

declare global {
  interface Window {
    Stripe?: any;
  }
}

@Injectable({
  providedIn: 'root'
})
export class StripeLoaderService {
  private stripePromise: Promise<any> | null = null;

  loadStripe(): Promise<any> {
    if (window.Stripe) {
      return Promise.resolve(window.Stripe);
    }

    if (this.stripePromise) {
      return this.stripePromise;
    }

    this.stripePromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.Stripe));
        existing.addEventListener('error', () => reject(new Error('Stripe script failed to load')));
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.onload = () => resolve(window.Stripe);
      script.onerror = () => reject(new Error('Stripe script failed to load'));
      document.head.appendChild(script);
    });

    return this.stripePromise;
  }
}
