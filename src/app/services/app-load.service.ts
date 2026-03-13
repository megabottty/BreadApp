import { Injectable, signal, computed } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class AppLoadService {
  private storefrontReadyState = signal(false);
  storefrontReady = computed(() => this.storefrontReadyState());

  setStorefrontReady(ready: boolean) {
    this.storefrontReadyState.set(ready);
  }
}
