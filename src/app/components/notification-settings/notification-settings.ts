import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferences,
  NotificationPreferencesPatch,
  NotificationPreferencesService
} from '../../services/notification-preferences.service';
import { AuthService } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';

type SmsKey = 'weekly_checkin_sms' | 'order_updates_sms' | 'promotions_sms';
type EmailKey = 'weekly_checkin_email' | 'order_updates_email' | 'promotions_email';

interface PreferenceRow {
  title: string;
  description: string;
  smsKey: SmsKey;
  emailKey: EmailKey;
}

/**
 * Lets a signed-in customer choose what we text or email them about.
 * Used inline on the profile (`compact`) and on its own /notifications page.
 */
@Component({
  selector: 'app-notification-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './notification-settings.html',
  styleUrls: ['./notification-settings.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationSettingsComponent implements OnInit {
  private readonly preferencesService = inject(NotificationPreferencesService);
  private readonly authService = inject(AuthService);
  private readonly toastService = inject(ToastService);

  /** Tighter spacing and no intro when embedded in the profile. */
  readonly compact = input<boolean>(false);

  readonly draft = signal<NotificationPreferences>({ ...DEFAULT_NOTIFICATION_PREFERENCES });
  readonly isSaving = signal<boolean>(false);
  readonly loadFailed = signal<boolean>(false);
  readonly isLoading = this.preferencesService.isLoading;

  readonly rows: readonly PreferenceRow[] = [
    {
      title: 'Weekly subscription check-in',
      description: 'Every Thursday we ask whether you want your bread that week. Reply YES or SKIP.',
      smsKey: 'weekly_checkin_sms',
      emailKey: 'weekly_checkin_email'
    },
    {
      title: 'Order updates',
      description: 'Confirmation when you order, and a heads-up when it\'s ready for pickup.',
      smsKey: 'order_updates_sms',
      emailKey: 'order_updates_email'
    },
    {
      title: 'Promotions & news',
      description: 'Occasional specials, new bakes, and seasonal loaves.',
      smsKey: 'promotions_sms',
      emailKey: 'promotions_email'
    }
  ];

  readonly wantsAnySms = computed<boolean>(() => {
    const d = this.draft();
    return d.weekly_checkin_sms || d.order_updates_sms || d.promotions_sms;
  });

  readonly phoneMissing = computed<boolean>(() => this.wantsAnySms() && !(this.draft().phone || '').trim());

  ngOnInit(): void {
    this.preferencesService.load().subscribe({
      next: (prefs) => this.draft.set({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...prefs,
        email: prefs.email || this.authService.user()?.email || null
      }),
      error: () => {
        this.loadFailed.set(true);
        this.draft.update(d => ({ ...d, email: this.authService.user()?.email || null }));
      }
    });
  }

  setPhone(value: string): void {
    this.draft.update(d => ({ ...d, phone: value }));
  }

  toggleSms(key: SmsKey, checked: boolean): void {
    // Turning any text back on is an explicit "START" from the customer.
    this.draft.update(d => ({ ...d, [key]: checked, sms_opted_out: checked ? false : d.sms_opted_out }));
  }

  toggleEmail(key: EmailKey, checked: boolean): void {
    this.draft.update(d => ({ ...d, [key]: checked }));
  }

  save(): void {
    if (this.phoneMissing()) {
      this.toastService.error('Add a phone number to receive texts, or turn the Text switches off.');
      return;
    }
    const d = this.draft();
    const patch: NotificationPreferencesPatch = {
      phone: (d.phone || '').trim() || null,
      email: (d.email || '').trim() || null,
      weekly_checkin_sms: d.weekly_checkin_sms,
      weekly_checkin_email: d.weekly_checkin_email,
      order_updates_sms: d.order_updates_sms,
      order_updates_email: d.order_updates_email,
      promotions_sms: d.promotions_sms,
      promotions_email: d.promotions_email,
      sms_opted_out: d.sms_opted_out
    };
    this.isSaving.set(true);
    this.preferencesService.save(patch).subscribe({
      next: (saved) => {
        this.isSaving.set(false);
        this.draft.set({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...saved });
        this.toastService.success('Notification settings saved.');
      },
      error: (err: { error?: { error?: string } }) => {
        this.isSaving.set(false);
        this.toastService.error(err?.error?.error || 'Couldn\'t save your settings. Please try again.');
      }
    });
  }
}
