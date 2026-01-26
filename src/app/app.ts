import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from './services/cart.service';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { SplashScreenComponent } from './components/splash-screen/splash-screen';
import { NotificationModalComponent } from './components/notification-modal/notification-modal';
import { ProductCustomizationModalComponent } from './components/product-customization-modal/product-customization-modal';
import { FooterComponent } from './components/footer/footer';
import { InstallPromptComponent } from './components/install-prompt/install-prompt';
import { PwaService } from './services/pwa.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationModalComponent, ProductCustomizationModalComponent, FooterComponent, InstallPromptComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('The Daily Dough');
  protected readonly cartService = inject(CartService);
  protected readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);
  protected readonly pwaService = inject(PwaService);

  isMenuOpen = signal(false);

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
