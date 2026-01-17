import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
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
  private router = inject(Router);

  name = signal('');
  email = signal('');
  password = signal('');
  confirmPassword = signal('');

  register() {
    if (this.password() !== this.confirmPassword()) {
      alert('Passwords do not match!');
      return;
    }

    // In this mock version, we just call the register method
    this.authService.register(this.name(), this.email());
  }
}
