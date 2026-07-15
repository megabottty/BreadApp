import { Injectable, computed, signal } from '@angular/core';
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
    if (typeof window === 'undefined') return;

    try {
      const response = await fetch('/api/config', { credentials: 'same-origin' });
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
