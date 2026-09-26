import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { TenantService } from './tenant.service';

/** What a customer wants to hear about, and how. Mirrors bakery_notification_preferences. */
export interface NotificationPreferences {
  customer_id?: string;
  phone: string | null;
  email: string | null;
  weekly_checkin_sms: boolean;
  weekly_checkin_email: boolean;
  order_updates_sms: boolean;
  order_updates_email: boolean;
  promotions_sms: boolean;
  promotions_email: boolean;
  /** Set when the customer replied STOP to a text. */
  sms_opted_out: boolean;
}

/** The fields the customer can edit (everything but the ids). */
export type NotificationPreferencesPatch = Omit<NotificationPreferences, 'customer_id'>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  phone: null,
  email: null,
  weekly_checkin_sms: true,
  weekly_checkin_email: true,
  order_updates_sms: true,
  order_updates_email: true,
  promotions_sms: false,
  promotions_email: true,
  sms_opted_out: false
};

export interface PromotionSendResult {
  sent: { sms: number; email: number };
  skipped: number;
}

@Injectable({ providedIn: 'root' })
export class NotificationPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly tenantService = inject(TenantService);
  private readonly apiUrl = `${environment.apiUrl}/notifications`;

  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly isLoading = signal<boolean>(false);

  private get headers(): HttpHeaders {
    const slug = this.tenantService.tenant()?.slug || 'thedailydough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  load(): Observable<NotificationPreferences> {
    this.isLoading.set(true);
    return this.http.get<NotificationPreferences>(`${this.apiUrl}/preferences`, { headers: this.headers }).pipe(
      tap({
        next: (prefs) => {
          this.preferences.set({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...prefs });
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false)
      })
    );
  }

  save(patch: NotificationPreferencesPatch): Observable<NotificationPreferences> {
    return this.http.put<NotificationPreferences>(`${this.apiUrl}/preferences`, patch, { headers: this.headers }).pipe(
      tap(saved => this.preferences.set({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...saved }))
    );
  }

  /** Baker only: text/email everyone who opted in to promotions. */
  sendPromotion(subject: string, message: string, channels: ('sms' | 'email')[]): Observable<PromotionSendResult> {
    return this.http.post<PromotionSendResult>(`${this.apiUrl}/promotion`, { subject, message, channels }, { headers: this.headers });
  }
}
