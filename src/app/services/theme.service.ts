import { Injectable, signal, effect, inject } from '@angular/core';
import { AuthService } from './auth.service';

export type Theme = 'natural' | 'sunset' | 'midnight';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private authService = inject(AuthService);
  private currentTheme = signal<Theme>(this.loadTheme());

  theme = this.currentTheme.asReadonly();

  constructor() {
    effect(() => {
      const theme = this.currentTheme();
      if (typeof document !== 'undefined') {
        document.body.setAttribute('data-theme', theme);
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bakery_theme', theme);
      }

      // Sync with profile if logged in
      if (this.authService.isAuthenticated()) {
        this.authService.updateUserMetadata({ theme: theme }).catch(err => {
          console.error('Failed to save theme to profile', err);
        });
      }
    });
  }

  setTheme(theme: Theme) {
    this.currentTheme.set(theme);
  }

  toggleTheme() {
    const themes: Theme[] = ['natural', 'sunset', 'midnight'];
    const currentIndex = themes.indexOf(this.currentTheme());
    const nextIndex = (currentIndex + 1) % themes.length;
    this.currentTheme.set(themes[nextIndex]);
  }

  private loadTheme(): Theme {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('bakery_theme') as Theme;
      if (['natural', 'sunset', 'midnight'].includes(saved)) {
        return saved;
      }
    }
    return 'natural';
  }
}
