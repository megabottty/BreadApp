import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'natural' | 'sunset' | 'midnight';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private currentTheme = signal<Theme>(this.loadTheme());

  theme = this.currentTheme.asReadonly();

  constructor() {
    effect(() => {
      const theme = this.currentTheme();
      document.body.setAttribute('data-theme', theme);
      localStorage.setItem('bakery_theme', theme);
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
    const saved = localStorage.getItem('bakery_theme') as Theme;
    return (['natural', 'sunset', 'midnight'].includes(saved)) ? saved : 'natural';
  }
}
