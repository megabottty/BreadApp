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
  tenant_id?: string;
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
    try {
      const { data: { session }, error } = await this.supabase.auth.getSession();
      if (error) {
        console.warn('[Auth] Session initialization error:', error.message);
        // If there's an error getting the session (like invalid refresh token),
        // Supabase might still have local data that needs clearing
        if (error.status === 400 || error.message.includes('Refresh Token')) {
          this.logout();
        }
      }

      if (session) {
        console.log('Session found on init:', session.user.email);
        this.handleAuthChange(session.user);
      } else {
        console.log('No session found on init');
      }
    } catch (e) {
      console.error('[Auth] Unexpected error during session init:', e);
    }

    this.supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      // Handle special event for signed out or token refresh failures
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        this.handleAuthChange(session?.user ?? null);
      } else {
        this.handleAuthChange(session?.user ?? null);
      }
    });
  }

  private handleAuthChange(supabaseUser: SupabaseUser | null) {
    if (supabaseUser) {
      console.log('[Auth Debug] Supabase User Metadata:', supabaseUser.user_metadata);

      const user: User = {
        id: supabaseUser.id,
        name: supabaseUser.user_metadata['full_name'] || supabaseUser.email?.split('@')[0] || 'User',
        email: supabaseUser.email || '',
        role: supabaseUser.user_metadata['role'] || 'CUSTOMER',
        tenant_id: supabaseUser.user_metadata['tenant_id']
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
        const tenant = this.currentUser()?.tenant_id;
        // Check if onboarding is completed if you have that flag, otherwise go to setup
        this.router.navigate(['/setup-wizard']);
      } else {
        this.router.navigate(['/front']);
      }
    }
  }

  async register(name: string, email: string, password: string, role: UserRole = 'CUSTOMER', bakeryName?: string, bakerySlug?: string) {
    console.log('[Auth Debug] Attempting to register:', email, role);

    // 1. Create the Auth User in Supabase
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

    // 2. If Baker, create their Bakery Tenant via the backend API
    if (role === 'BAKER' && bakeryName && bakerySlug) {
      try {
        const tenantResponse = await fetch(`${environment.apiUrl}/orders/register-bakery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: bakeryName, slug: bakerySlug })
        });

        if (!tenantResponse.ok) {
          const errData = await tenantResponse.json();
          throw new Error(errData.error || 'Failed to create bakery');
        }

        const tenant = await tenantResponse.json();
        console.log('[Auth Debug] Bakery created:', tenant.slug);

        // Update user metadata with tenant_id if possible, or just rely on the slug in the URL later
        await this.supabase.auth.updateUser({
          data: { tenant_id: tenant.id, bakery_slug: tenant.slug }
        });

      } catch (tenantError: any) {
        console.error('[Auth Error] Bakery creation failed:', tenantError.message);

        // Pass through specific backend errors if they exist
        let errorMessage = 'Failed to create bakery setup. Please check your connection and try again.';

        if (tenantError.message.includes('slug is already taken')) {
          errorMessage = tenantError.message;
        } else if (tenantError.message.includes('Database table missing')) {
          errorMessage = tenantError.message;
        }

        throw new Error(errorMessage);
      }
    }

    if (data.user) {
      // Check if session exists (if not, email confirmation is likely enabled)
      const { data: sessionData } = await this.supabase.auth.getSession();

      if (!sessionData.session) {
        console.log('[Auth Debug] No session after registration, likely needs email verification');
        return { needsVerification: true };
      }

      if (role === 'BAKER') {
        this.router.navigate(['/setup-wizard']);
      } else {
        this.router.navigate(['/front']);
      }
    }
    return { needsVerification: false };
  }

  async logout() {
    await this.supabase.auth.signOut();
    this.currentUser.set(null);
    this.router.navigate(['/front']);
  }
}
