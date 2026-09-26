import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NotificationSettingsComponent } from './notification-settings';

/** The standalone /notifications page: a heading around the settings form. */
@Component({
  selector: 'app-notification-settings-page',
  standalone: true,
  imports: [NotificationSettingsComponent, RouterLink],
  template: `
    <div class="notifications-page">
      <header>
        <h1>Notification settings</h1>
        <p class="subtitle">How and when The Daily Dough gets in touch.</p>
      </header>
      <div class="card">
        <app-notification-settings></app-notification-settings>
      </div>
      <p class="back-link"><a routerLink="/profile">← Back to your profile</a></p>
    </div>
  `,
  styles: [`
    .notifications-page {
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1rem 3rem;
    }

    header {
      text-align: center;
      margin-bottom: 1.5rem;
    }

    h1 {
      font-family: 'Serif', Georgia, serif;
      color: var(--accent-sage-dark);
      margin: 0 0 0.25rem;
    }

    .subtitle {
      margin: 0;
      color: var(--text-secondary);
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg, 12px);
      padding: 1.5rem;
      box-shadow: 0 10px 25px var(--shadow-color);
    }

    .back-link {
      margin-top: 1.25rem;
      text-align: center;
    }

    .back-link a {
      color: var(--accent-sage-dark);
      font-weight: 600;
      text-decoration: none;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationSettingsPageComponent {}
