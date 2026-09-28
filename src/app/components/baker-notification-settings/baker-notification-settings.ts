import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BakerAlertEvent,
  BakerNotificationSettings,
  BakerNotificationSettingsService,
  DEFAULT_BAKER_NOTIFICATION_SETTINGS
} from '../../services/baker-notification-settings.service';
import { TenantService } from '../../services/tenant.service';
import { ToastService } from '../../services/toast.service';

interface AlertRow {
  event: BakerAlertEvent;
  title: string;
  description: string;
}

/** Business Settings → how the baker wants to hear about her own bakery. */
@Component({
  selector: 'app-baker-notification-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './baker-notification-settings.html',
  styleUrls: ['./baker-notification-settings.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BakerNotificationSettingsComponent implements OnInit {
  private readonly settingsService = inject(BakerNotificationSettingsService);
  private readonly tenantService = inject(TenantService);
  private readonly toastService = inject(ToastService);

  readonly draft = signal<BakerNotificationSettings>(structuredClone(DEFAULT_BAKER_NOTIFICATION_SETTINGS));
  readonly isSaving = signal<boolean>(false);
  readonly isTesting = signal<boolean>(false);
  readonly loadFailed = signal<boolean>(false);
  readonly isLoading = this.settingsService.isLoading;

  readonly rows: readonly AlertRow[] = [
    { event: 'newOrder', title: 'New orders', description: 'The moment an order is placed online or paid by card: who, what, and the pickup day.' },
    { event: 'ordersDue', title: 'Orders due', description: 'A prep reminder two days before each pickup (feed the starter!) and a morning list of today\'s pickups.' },
    { event: 'lowStock', title: 'Running low', description: 'A daily heads-up while any ingredient is under its minimum stock in Inventory.' }
  ];

  readonly wantsAnySms = computed<boolean>(() => Object.values(this.draft().events).some(channels => channels.sms));
  readonly wantsAnyEmail = computed<boolean>(() => Object.values(this.draft().events).some(channels => channels.email));
  readonly phoneMissing = computed<boolean>(() => this.wantsAnySms() && !(this.draft().phone || '').trim());
  readonly emailMissing = computed<boolean>(() => this.wantsAnyEmail() && !(this.draft().email || '').trim());

  ngOnInit(): void {
    this.settingsService.load().subscribe({
      next: settings => this.draft.set(this.withFallbacks(settings)),
      error: () => {
        this.loadFailed.set(true);
        this.draft.set(this.withFallbacks(structuredClone(DEFAULT_BAKER_NOTIFICATION_SETTINGS)));
      }
    });
  }

  setPhone(value: string): void {
    this.draft.update(d => ({ ...d, phone: value }));
  }

  setEmail(value: string): void {
    this.draft.update(d => ({ ...d, email: value }));
  }

  toggle(event: BakerAlertEvent, channel: 'sms' | 'email', checked: boolean): void {
    this.draft.update(d => ({
      ...d,
      events: { ...d.events, [event]: { ...d.events[event], [channel]: checked } }
    }));
  }

  save(): void {
    if (this.phoneMissing()) {
      this.toastService.error('Add a mobile number for texts, or turn the Text switches off.');
      return;
    }
    if (this.emailMissing()) {
      this.toastService.error('Add an email address, or turn the Email switches off.');
      return;
    }
    const d = this.draft();
    this.isSaving.set(true);
    this.settingsService.save({
      phone: (d.phone || '').trim() || null,
      email: (d.email || '').trim() || null,
      events: d.events
    }).subscribe({
      next: saved => {
        this.isSaving.set(false);
        this.draft.set(this.withFallbacks(saved));
        this.toastService.success('Alert settings saved.');
      },
      error: (err: { error?: { error?: string } }) => {
        this.isSaving.set(false);
        this.toastService.error(err?.error?.error || 'Couldn\'t save your alert settings. Please try again.');
      }
    });
  }

  sendTest(): void {
    this.isTesting.set(true);
    this.settingsService.sendTest().subscribe({
      next: result => {
        this.isTesting.set(false);
        const channels = [result.sms ? 'text' : null, result.email ? 'email' : null].filter(Boolean);
        this.toastService.success(channels.length ? `Test alert sent by ${channels.join(' and ')}.` : 'Nothing sent: check your number, email, and the New orders switches, then save.');
      },
      error: () => {
        this.isTesting.set(false);
        this.toastService.error('Couldn\'t send a test alert.');
      }
    });
  }

  /** Empty phone/email default to the bakery's public contact details. */
  private withFallbacks(settings: BakerNotificationSettings): BakerNotificationSettings {
    const tenant = this.tenantService.tenant();
    return {
      ...settings,
      phone: settings.phone || tenant?.phone || null,
      email: settings.email || tenant?.email || null
    };
  }
}
