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
  showPassword = signal(false);

  async login() {
    try {
      await this.authService.login(this.email(), this.password());

      // If the login was successful, check for a returnUrl
      const returnUrl = this.route.snapshot.queryParams['returnUrl'];
      if (returnUrl) {
        this.router.navigateByUrl(returnUrl);
      }
    } catch (error: any) {
      this.modalService.showAlert(error.message || 'Login failed', 'Login Error', 'error');
    }
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  setRole(role: UserRole) {
    this.selectedRole.set(role);
  }
}
