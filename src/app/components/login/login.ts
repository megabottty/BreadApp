import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, UserRole } from '../../services/auth.service';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrls: ['./login.css']
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  email = signal('');
  password = signal('');
  selectedRole = signal<UserRole>('CUSTOMER');

  login() {
    // In this mock version, we just call the existing login with the selected role
    // and dummy credentials.
    this.authService.login(this.selectedRole());
  }

  setRole(role: UserRole) {
    this.selectedRole.set(role);
  }
}
