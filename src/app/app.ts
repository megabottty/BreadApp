import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { TitleCasePipe } from '@angular/common';
import { filter } from 'rxjs';
import { CartService } from './services/cart.service';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { NotificationModalComponent } from './components/notification-modal/notification-modal';
import { ProductCustomizationModalComponent } from './components/product-customization-modal/product-customization-modal';
import { FooterComponent } from './components/footer/footer';
import { InstallPromptComponent } from './components/install-prompt/install-prompt';
import { PwaService } from './services/pwa.service';
import { SplashScreenComponent } from './components/splash-screen/splash-screen';
import { ToastContainerComponent } from './components/toast-container/toast-container';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TitleCasePipe,
    NotificationModalComponent,
    ProductCustomizationModalComponent,
    FooterComponent,
    InstallPromptComponent,
    SplashScreenComponent,
    ToastContainerComponent,
    FormsModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('The Daily Dough');
  protected readonly cartService = inject(CartService);
  protected readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);
  protected readonly pwaService = inject(PwaService);
  private readonly router = inject(Router);

  isMenuOpen = signal(false);
  currentUrl = signal(this.router.url);
  storefrontSearch = signal('');

  constructor() {
    this.syncSearchFromUrl(this.router.url);

    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(event => {
        this.currentUrl.set(event.urlAfterRedirects);
        this.syncSearchFromUrl(event.urlAfterRedirects);
      });
  }

  private syncSearchFromUrl(url: string) {
    const [, query = ''] = url.split('?');
    const params = new URLSearchParams(query);
    this.storefrontSearch.set(params.get('q') || '');
  }

  showStorefrontSearch(): boolean {
    return this.currentUrl().startsWith('/front');
  }

  onStorefrontSearchChange(value: string) {
    this.storefrontSearch.set(value);
    this.navigateStorefrontSearch(value);
  }

  submitStorefrontSearch(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    this.navigateStorefrontSearch(this.storefrontSearch());
    (event.target as HTMLInputElement | null)?.blur();
  }

  private navigateStorefrontSearch(value: string) {
    this.router.navigate(['/front'], {
      queryParams: { q: value?.trim() || null },
      queryParamsHandling: 'merge'
    });
  }

  toggleMenu() {
    this.isMenuOpen.update(val => !val);
  }

  closeMenu() {
    this.isMenuOpen.set(false);
  }

  logout() {
    this.authService.logout();
    this.closeMenu();
  }
}
