import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, UserRole } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent {
  private authService = inject(AuthService);
  private modalService = inject(ModalService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  email = signal('');
  password = signal('');
  selectedRole = signal<UserRole>('CUSTOMER');
  /** Where to go after logging in (or after creating an account instead). */
  readonly returnUrl: string | null = this.route.snapshot.queryParams['returnUrl'] || null;
  showPassword = signal(false);

  async login() {
    let destination = '/front';
    try {
      destination = await this.authService.login(this.email(), this.password());
    } catch (error: any) {
      this.modalService.showAlert(error.message || 'Login failed', 'Login Error', 'error');
      return;
    }

    const target = this.returnUrl || destination;
    // Leave the sign-in page no matter what: if the in-app navigation is
    // refused or fails (e.g. the lazy chunk can't load after a deploy), fall
    // back to a full page load of the destination.
    let navigated = false;
    try {
      navigated = await this.router.navigateByUrl(target);
    } catch (err) {
      console.warn('[Login] In-app navigation failed, reloading:', err);
    }
    if (!navigated && typeof window !== 'undefined') {
      window.location.assign(target);
    }
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  setRole(role: UserRole) {
    this.selectedRole.set(role);
  }
}
