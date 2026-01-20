import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

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
  private supabase: SupabaseClient;
  private currentUser = signal<User | null>(null);

  user = computed(() => this.currentUser());
  isBaker = computed(() => this.currentUser()?.role === 'BAKER');
  isCustomer = computed(() => this.currentUser()?.role === 'CUSTOMER');
  isAuthenticated = computed(() => this.currentUser() !== null);

  constructor() {
    const supabaseUrl = environment.supabaseUrl;
    const supabaseKey = environment.supabaseKey;

    if (supabaseUrl === 'https://your-project.supabase.co') {
      console.warn('Supabase URL is still using the placeholder in environment.ts. Please update it!');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);

    // Check for saved session
    this.initSession();
  }

  private async initSession() {
    const { data: { session } } = await this.supabase.auth.getSession();
    if (session) {
      console.log('Session found on init:', session.user.email);
      this.handleAuthChange(session.user);
    } else {
      console.log('No session found on init');
    }

    this.supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      this.handleAuthChange(session?.user ?? null);
    });
  }

  private handleAuthChange(supabaseUser: SupabaseUser | null) {
    if (supabaseUser) {
      console.log('[Auth Debug] Supabase User Metadata:', supabaseUser.user_metadata);

      const user: User = {
        id: supabaseUser.id,
        name: supabaseUser.user_metadata['full_name'] || supabaseUser.email?.split('@')[0] || 'User',
        email: supabaseUser.email || '',
        role: supabaseUser.user_metadata['role'] || 'CUSTOMER'
      };

      console.log('[Auth Debug] Final User Object with Role:', user);
      this.currentUser.set(user);
    } else {
      this.currentUser.set(null);
    }
  }

  async login(email: string, password: string) {
    console.log('[Auth Debug] Attempting login:', email);
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('[Auth Error] Login failed:', error.message);
      throw error;
    }

    if (data.user) {
      console.log('[Auth Debug] Login successful, user metadata:', data.user.user_metadata);
      const role = data.user.user_metadata['role'] as UserRole;
      if (role === 'BAKER') {
        this.router.navigate(['/calculator']);
      } else {
        this.router.navigate(['/front']);
      }
    }
  }

  async register(name: string, email: string, password: string, role: UserRole = 'CUSTOMER') {
    console.log('[Auth Debug] Attempting to register:', email, role);
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          role: role
        }
      }
    });

    if (error) {
      console.error('[Auth Error] Registration failed:', error.message);
      throw error;
    }

    console.log('[Auth Debug] Registration successful:', data.user?.email);
    if (data.user) {
      if (role === 'BAKER') {
        this.router.navigate(['/calculator']);
      } else {
        this.router.navigate(['/front']);
      }
    }
  }

  async logout() {
    await this.supabase.auth.signOut();
    this.currentUser.set(null);
    this.router.navigate(['/front']);
  }
}
