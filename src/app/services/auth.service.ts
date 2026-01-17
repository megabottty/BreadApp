import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

export type UserRole = 'BAKER' | 'CUSTOMER' | null;

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router = inject(Router);
  private currentUser = signal<User | null>(null);

  user = computed(() => this.currentUser());
  isBaker = computed(() => this.currentUser()?.role === 'BAKER');
  isCustomer = computed(() => this.currentUser()?.role === 'CUSTOMER');
  isAuthenticated = computed(() => this.currentUser() !== null);

  constructor() {
    // Check for saved session
    const saved = localStorage.getItem('bakery_user');
    if (saved) {
      this.currentUser.set(JSON.parse(saved));
    }
  }

  login(role: UserRole) {
    const mockUser: User = {
      id: role === 'BAKER' ? 'b1' : 'c1',
      name: role === 'BAKER' ? 'The Head Baker' : 'Bread Lover',
      email: role === 'BAKER' ? 'baker@dailydough.com' : 'customer@example.com',
      role
    };
    this.currentUser.set(mockUser);
    localStorage.setItem('bakery_user', JSON.stringify(mockUser));

    // Role-based redirection
    if (role === 'BAKER') {
      this.router.navigate(['/calculator']);
    } else {
      this.router.navigate(['/store']);
    }
  }

  register(name: string, email: string) {
    const mockUser: User = {
      id: 'c' + Math.floor(Math.random() * 1000),
      name,
      email,
      role: 'CUSTOMER'
    };
    this.currentUser.set(mockUser);
    localStorage.setItem('bakery_user', JSON.stringify(mockUser));
    this.router.navigate(['/store']);
  }

  logout() {
    this.currentUser.set(null);
    localStorage.removeItem('bakery_user');
    this.router.navigate(['/store']);
  }
}
