import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap, finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { TenantService } from './tenant.service';

export type BakerAlertEvent = 'newOrder' | 'ordersDue' | 'lowStock';

export interface BakerAlertChannels {
  sms: boolean;
  email: boolean;
}

export interface BakerNotificationSettings {
  phone: string | null;
  email: string | null;
  events: Record<BakerAlertEvent, BakerAlertChannels>;
}

export interface BakerNotificationSettingsPatch {
  phone?: string | null;
  email?: string | null;
  events?: Partial<Record<BakerAlertEvent, Partial<BakerAlertChannels>>>;
}

export interface BakerTestAlertResult {
  sms: boolean;
  email: boolean;
  skipped?: string;
}

export const DEFAULT_BAKER_NOTIFICATION_SETTINGS: BakerNotificationSettings = {
  phone: null,
  email: null,
  events: {
    newOrder: { sms: true, email: true },
    ordersDue: { sms: true, email: true },
    lowStock: { sms: false, email: true }
  }
};

/** The baker's own alert switches (stored on the tenant; see server/utils/baker-notify.cjs). */
@Injectable({ providedIn: 'root' })
export class BakerNotificationSettingsService {
  private readonly http = inject(HttpClient);
  private readonly tenantService = inject(TenantService);
  private readonly url = `${environment.apiUrl}/orders/baker-notifications`;

  readonly settings = signal<BakerNotificationSettings>(DEFAULT_BAKER_NOTIFICATION_SETTINGS);
  readonly isLoading = signal<boolean>(false);

  private get headers(): HttpHeaders {
    const slug = this.tenantService.tenant()?.slug || 'thedailydough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  load(): Observable<BakerNotificationSettings> {
    this.isLoading.set(true);
    return this.http.get<BakerNotificationSettings>(this.url, { headers: this.headers }).pipe(
      tap(settings => this.settings.set(settings)),
      finalize(() => this.isLoading.set(false))
    );
  }

  save(patch: BakerNotificationSettingsPatch): Observable<BakerNotificationSettings> {
    return this.http.put<BakerNotificationSettings>(this.url, patch, { headers: this.headers }).pipe(
      tap(settings => this.settings.set(settings))
    );
  }

  sendTest(): Observable<BakerTestAlertResult> {
    return this.http.post<BakerTestAlertResult>(`${this.url}/test`, {}, { headers: this.headers });
  }
}
