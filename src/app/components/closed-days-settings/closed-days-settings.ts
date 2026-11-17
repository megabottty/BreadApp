import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../services/tenant.service';
import { ToastService } from '../../services/toast.service';

/** A run of consecutive closed days, shown as one row ("Dec 24 – Dec 26"). */
export interface ClosedRange {
  start: string;
  end: string;
  days: string[];
}

/**
 * Business Settings → days the bakery is closed. Customers can't pick these
 * for pickup (bag + server check), and the daily scheduler skips any weekly
 * subscription due on one of them (not charged) and texts the customer.
 */
@Component({
  selector: 'app-closed-days-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './closed-days-settings.html',
  styleUrls: ['./closed-days-settings.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ClosedDaysSettingsComponent {
  private readonly tenantService = inject(TenantService);
  private readonly toastService = inject(ToastService);

  readonly today: string = denverToday();
  fromDate = signal<string>('');
  toDate = signal<string>('');
  saving = signal<boolean>(false);

  /** Upcoming closed days, sorted. */
  closedDates = computed((): string[] =>
    (this.tenantService.tenant()?.closed_dates ?? []).filter((d: string) => d >= this.today).sort());

  ranges = computed((): ClosedRange[] => groupIntoRanges(this.closedDates()));

  addDays(): void {
    const from = this.fromDate();
    const to = this.toDate() || from;
    if (!from) {
      this.toastService.error('Pick the first day you\'re closed.');
      return;
    }
    if (from < this.today) {
      this.toastService.error('That day has already passed.');
      return;
    }
    if (to < from) {
      this.toastService.error('The last day can\'t be before the first day.');
      return;
    }
    const added = datesBetween(from, to);
    if (added.length > 90) {
      this.toastService.error('Please add closures of 90 days or fewer at a time.');
      return;
    }
    this.save([...this.closedDates(), ...added], () => {
      this.fromDate.set('');
      this.toDate.set('');
    });
  }

  removeRange(range: ClosedRange): void {
    const removing = new Set(range.days);
    this.save(this.closedDates().filter((d: string) => !removing.has(d)));
  }

  formatRange(range: ClosedRange): string {
    const fmt = (d: string): string => new Date(`${d}T00:00:00Z`)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    return range.start === range.end ? fmt(range.start) : `${fmt(range.start)} – ${fmt(range.end)}`;
  }

  private save(dates: string[], onSaved?: () => void): void {
    const tenant = this.tenantService.tenant();
    if (!tenant) return;
    this.saving.set(true);
    const unique = [...new Set(dates)].sort();
    this.tenantService.saveClosedDates(tenant.id, unique).subscribe({
      next: () => {
        this.saving.set(false);
        this.toastService.success('Closed days saved.');
        onSaved?.();
      },
      error: (err: { error?: { error?: string } }) => {
        this.saving.set(false);
        this.toastService.error(err?.error?.error || 'Couldn\'t save your closed days. Please try again.');
      }
    });
  }
}

function addDay(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length <= 366; d = addDay(d, 1)) days.push(d);
  return days;
}

/** Sorted dates → runs of consecutive days. */
export function groupIntoRanges(sorted: string[]): ClosedRange[] {
  const ranges: ClosedRange[] = [];
  for (const day of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && addDay(last.end, 1) === day) {
      last.end = day;
      last.days.push(day);
    } else {
      ranges.push({ start: day, end: day, days: [day] });
    }
  }
  return ranges;
}

function denverToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}
