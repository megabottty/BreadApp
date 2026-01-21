import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, UserRole } from '../../services/auth.service';
import { ModalService } from '../../services/modal.service';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './register.html',
  styleUrls: ['./register.css']
})
export class RegisterComponent {
  private authService = inject(AuthService);
  private modalService = inject(ModalService);
  private router = inject(Router);

  name = signal('');
  email = signal('');
  password = signal('');
  confirmPassword = signal('');
  selectedRole = signal<UserRole>('CUSTOMER');
  showPassword = signal(false);
  registrationSuccess = signal(false);

  // Baker specific signals
  bakeryName = signal('');
  bakerySlug = signal('');

  passwordErrors = computed(() => {
    const p = this.password();
    const errors: string[] = [];
    if (p.length > 0 && p.length < 8) errors.push('At least 8 characters');
    if (p.length > 0 && !/[A-Z]/.test(p)) errors.push('One uppercase letter');
    if (p.length > 0 && !/[0-9]/.test(p)) errors.push('One number');
    if (p.length > 0 && !/[!@#$%^&*]/.test(p)) errors.push('One special character (!@#$%^&*)');
    return errors;
  });

  isPasswordValid = computed(() => this.password().length >= 8 && this.passwordErrors().length === 0);

  async register() {
    if (!this.isPasswordValid()) {
      this.modalService.showAlert('Please ensure your password meets all requirements.', 'Invalid Password', 'warning');
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.modalService.showAlert('Passwords do not match!', 'Registration Error', 'error');
      return;
    }

    if (this.selectedRole() === 'BAKER') {
      if (!this.bakeryName() || !this.bakerySlug()) {
        this.modalService.showAlert('Please provide your Bakery name and choose a shop URL.', 'Incomplete Info', 'warning');
        return;
      }
    }

    try {
      const result = await this.authService.register(
        this.name(),
        this.email(),
        this.password(),
        this.selectedRole(),
        this.selectedRole() === 'BAKER' ? this.bakeryName() : undefined,
        this.selectedRole() === 'BAKER' ? this.bakerySlug() : undefined
      );

      if (result?.needsVerification) {
        this.registrationSuccess.set(true);
      }
    } catch (error: any) {
      this.modalService.showAlert(error.message || 'Registration failed', 'Registration Error', 'error');
    }
  }

  togglePassword() {
    this.showPassword.update(v => !v);
  }

  setRole(role: UserRole) {
    this.selectedRole.set(role);
  }
}
