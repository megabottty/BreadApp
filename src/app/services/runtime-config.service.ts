import { Injectable, REQUEST, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export type SiteMode = 'public' | 'admin-preview';

export interface RuntimeConfig {
  siteMode: SiteMode;
  apiUrl: string;
  frontendUrl: string;
  supabaseUrl: string;
  supabaseKey: string;
  stripePublicKey: string;
}

const defaultConfig: RuntimeConfig = {
  siteMode: 'admin-preview',
  apiUrl: environment.apiUrl,
  frontendUrl: '',
  supabaseUrl: environment.supabaseUrl,
  supabaseKey: environment.supabaseKey,
  stripePublicKey: environment.stripePublicKey
};

@Injectable({
  providedIn: 'root'
})
export class RuntimeConfigService {
  private readonly configState = signal<RuntimeConfig>(defaultConfig);
  readonly config = computed(() => this.configState());
  readonly siteMode = computed(() => this.configState().siteMode);
  readonly isPublicMode = computed(() => this.siteMode() === 'public');

  async load(): Promise<void> {
    // On the server, there's no `window`/relative-URL resolution, so we build
    // an absolute URL from the incoming request (available via Angular's
    // REQUEST token during SSR) to fetch the same config the client would get.
    const isServer = typeof window === 'undefined';
    let base = '';
    if (isServer) {
      const req = inject(REQUEST, { optional: true });
      if (req) {
        try {
          base = new URL(req.url).origin;
        } catch {
          // Fall through with an empty base; fetch below will fail gracefully.
        }
      }
    }

    try {
      const response = await fetch(`${base}/api/config`, { credentials: 'same-origin' });
      if (!response.ok) return;

      const payload = await response.json();
      const merged: RuntimeConfig = {
        ...defaultConfig,
        ...payload,
        siteMode: payload?.siteMode === 'public' ? 'public' : 'admin-preview'
      };
      this.configState.set(merged);
    } catch {
      // Keep environment defaults if runtime config endpoint is unavailable.
    }
  }
}
