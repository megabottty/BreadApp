import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from './services/cart.service';
import { AuthService } from './services/auth.service';
import { ThemeService } from './services/theme.service';
import { SplashScreenComponent } from './components/splash-screen/splash-screen';
import { NotificationModalComponent } from './components/notification-modal/notification-modal';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NotificationModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('The Daily Dough');
  protected readonly cartService = inject(CartService);
  protected readonly authService = inject(AuthService);
  protected readonly themeService = inject(ThemeService);

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
