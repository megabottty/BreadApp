import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import { TenantService } from './tenant.service';
import { logger } from '../utils/logger';

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
  private tenantService = inject(TenantService);
  private supabase: SupabaseClient | null = null;
  private async ensureSupabase() {
    if (this.supabase) return this.supabase;
    const { createClient } = await import('@supabase/supabase-js');
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
    return this.supabase;
  }
  private currentUser = signal<User | null>(null);

  user = computed(() => this.currentUser());
  isBaker = computed(() => this.currentUser()?.role === 'BAKER');
  isCustomer = computed(() => this.currentUser()?.role === 'CUSTOMER');
  isAuthenticated = computed(() => this.currentUser() !== null);

  constructor() {
    const supabaseUrl = environment.supabaseUrl;
    const supabaseKey = environment.supabaseKey;

    if (supabaseUrl === 'https://your-project.supabase.co') {
      logger.warn('Supabase URL is still using the placeholder in environment.ts. Please update it!');
    }

    // Don't eagerly load Supabase; create client on-demand to avoid adding it to the initial bundle.
    this.initSession();
  }

  private async initSession() {
    try {
      const supabase = await this.ensureSupabase();
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        logger.warn('[Auth] Session initialization error:', error.message);
        // If there's an error getting the session (like invalid refresh token),
        // Supabase might still have local data that needs clearing
        if (error.status === 400 || error.message.includes('Refresh Token')) {
          this.logout();
        }
      }

      if (session) {
        logger.info('Session found on init:', session.user.email);
        this.handleAuthChange(session.user);
      } else {
        logger.debug('No session found on init');
      }
    } catch (e) {
      logger.error('[Auth] Unexpected error during session init:', e);
    }

    const supabase = await this.ensureSupabase();
    supabase.auth.onAuthStateChange((event, session) => {
      logger.debug('Auth state changed:', event, session?.user?.email);
      this.handleAuthChange(session?.user ?? null);
    });
  }

  private handleAuthChange(supabaseUser: SupabaseUser | null) {
    if (supabaseUser) {
      logger.debug('[Auth Debug] Supabase User Metadata:', supabaseUser.user_metadata);

      const role = supabaseUser.user_metadata['role'] || 'CUSTOMER';
      const onboardingCompleted = supabaseUser.user_metadata['onboarding_completed'];
      const bakerySlug = supabaseUser.user_metadata['bakery_slug'];
      const theme = supabaseUser.user_metadata['theme'];

      const user: User = {
        id: supabaseUser.id,
        name: supabaseUser.user_metadata['full_name'] || supabaseUser.email?.split('@')[0] || 'User',
        email: supabaseUser.email || '',
        role: role,
        tenant_id: supabaseUser.user_metadata['tenant_id']
      };

      logger.debug('[Auth Debug] Final User Object with Role:', user);
      this.currentUser.set(user);

      // If we have a bakery slug in metadata, ensure TenantService loads it
      if (bakerySlug) {
        logger.debug('[Auth Debug] Found bakery slug in metadata, loading tenant:', bakerySlug);
        this.tenantService.loadTenantInfo(bakerySlug);
      }

      // If we have a theme in metadata, apply it
      if (theme) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('bakery_theme', theme);
        }
      }

      // Proactive redirection for BAKERs who haven't finished setup
      // Only redirect if we are on a page that isn't the wizard itself or the front
      if (typeof window === 'undefined') return;
      const path = window.location.pathname;
      const isE2E = window.location.search.includes('e2e=1');

      if (!isE2E && role === 'BAKER' && !onboardingCompleted && !path.includes('/setup-wizard') && !path.includes('/register')) {
        logger.info('[Auth Debug] Redirecting BAKER to Setup Wizard');
        this.router.navigate(['/setup-wizard']);
      }
    } else {
      this.currentUser.set(null);
    }
  }

  async login(email: string, password: string) {
    logger.debug('[Auth Debug] Attempting login:', email);
    const supabase = await this.ensureSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      logger.error('[Auth Error] Login failed:', error.message);
      throw error;
    }

    if (data.user) {
      logger.info('[Auth Debug] Login successful, user metadata:', data.user.user_metadata);
      const role = data.user.user_metadata['role'] as UserRole;

      // Update the currentUser signal immediately
      this.handleAuthChange(data.user);

      if (role === 'BAKER') {
        const onboardingCompleted = data.user.user_metadata['onboarding_completed'];
        if (onboardingCompleted) {
          this.router.navigate(['/dashboard']);
        } else {
          this.router.navigate(['/setup-wizard']);
        }
      } else {
        this.router.navigate(['/front']);
      }
    }
  }

  async register(name: string, email: string, password: string, role: UserRole = 'CUSTOMER', bakeryName?: string, bakerySlug?: string) {
    logger.debug('[Auth Debug] Attempting to register:', email, role);

    // 1. Create the Auth User in Supabase
    const supabase = await this.ensureSupabase();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          role: role
        },
        emailRedirectTo: (typeof window !== 'undefined' ? window.location.origin : '') + '/login'
      }
    });

    if (error) {
      logger.error('[Auth Error] Registration failed:', error.message);
      throw error;
    }

    logger.info('[Auth Debug] Registration successful:', data.user?.email);

    // 2. If Baker, create their Bakery Tenant via the backend API
    if (role === 'BAKER' && bakeryName && bakerySlug) {
      try {
        logger.debug('[Auth Debug] Creating bakery for tenant:', bakerySlug);

        // Use an absolute URL if we are in development to be 100% sure we hit the backend
        // In production, /api works because they are on the same domain
        const isE2E = typeof window !== 'undefined' && window.location.search.includes('e2e=1');
        const baseUrl = (typeof window !== 'undefined' && window.location.hostname === 'localhost' && !isE2E) ? 'http://localhost:3000' : '';
        const apiUrl = `${baseUrl}${environment.apiUrl}/orders/register-bakery`;

        logger.debug('[Auth Debug] Calling API:', apiUrl, 'with body:', { name: bakeryName, slug: bakerySlug });

        const tenantResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: bakeryName, slug: bakerySlug })
        });

        logger.debug('[Auth Debug] API Response Status:', tenantResponse.status);

        if (!tenantResponse.ok) {
          const rawResponse = await tenantResponse.text();
          logger.error('[Auth Error] Server returned error response:', rawResponse);

          let errData;
          try {
            errData = JSON.parse(rawResponse);
          } catch {
            errData = { error: `Server error (${tenantResponse.status}): ${rawResponse.substring(0, 100)}` };
          }
          throw new Error(errData.error || errData.message || `Server returned ${tenantResponse.status}`);
        }

        const tenant = await tenantResponse.json();
        logger.info('[Auth Debug] Bakery created:', tenant.slug);

        // Save slug to localStorage so TenantService can find it immediately
        // localStorage.setItem('bakery_slug', tenant.slug);

        // Explicitly load the new tenant info
        this.tenantService.loadTenantInfo(tenant.slug);

        // Update user metadata with tenant_id if possible, or just rely on the slug in the URL later
        const supabase = await this.ensureSupabase();
        await supabase.auth.updateUser({
          data: { tenant_id: tenant.id, bakery_slug: tenant.slug }
        });

      } catch (tenantError: any) {
        logger.error('[Auth Error] Bakery creation failed:', tenantError.message);

        // Pass through specific backend errors if they exist
        let errorMessage = tenantError.message || 'Failed to create bakery setup. Please check your connection and try again.';

        if (tenantError.message.includes('slug is already taken')) {
          errorMessage = tenantError.message;
        } else if (tenantError.message.includes('Database table missing')) {
          errorMessage = tenantError.message;
        } else if (tenantError.message.includes('Server error')) {
          errorMessage = tenantError.message;
        }

        throw new Error(errorMessage);
      }
    }

    if (data.user) {
      // Check if session exists (if not, email confirmation is likely enabled)
      const supabase = await this.ensureSupabase();
    const { data: sessionData } = await supabase.auth.getSession();

      if (!sessionData.session) {
        logger.debug('[Auth Debug] No session after registration, likely needs email verification');
        return { needsVerification: true };
      }

      // Update the currentUser signal immediately
      this.handleAuthChange(data.user);

      if (role === 'BAKER') {
        this.router.navigate(['/setup-wizard']);
      } else {
        this.router.navigate(['/front']);
      }
    }
    return { needsVerification: false };
  }

  async logout() {
    const supabase = await this.ensureSupabase();
    await supabase.auth.signOut();
    this.currentUser.set(null);
    this.router.navigate(['/front']);
  }

  async updateUserMetadata(data: any) {
    try {
      const supabase = await this.ensureSupabase();
      const { error } = await supabase.auth.updateUser({
        data: data
      });

      if (error) {
        logger.error('[Auth Error] Failed to update user metadata:', error);
        throw error;
      }

      // Refresh session to get updated metadata
      await supabase.auth.refreshSession();
    } catch (error) {
      logger.error('[Auth Error] Unexpected error updating metadata:', error);
      throw error;
    }
  }

  // Helper method to sync tenant_id to user metadata (for existing users)
  async syncTenantToMetadata(tenantId: string, bakerySlug: string) {
    try {
      const supabase = await this.ensureSupabase();
      const { data, error } = await supabase.auth.updateUser({
        data: {
          tenant_id: tenantId,
          bakery_slug: bakerySlug,
          onboarding_completed: true
        }
      });

      if (error) {
        logger.error('[Auth Error] Failed to sync tenant metadata:', error);
        throw error;
      }

      logger.info('[Auth Debug] Successfully synced tenant_id to user metadata:', data);

      // Force refresh the session to get the updated JWT with new metadata
      const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession();

      if (refreshError) {
        logger.error('[Auth Error] Failed to refresh session:', refreshError);
        throw refreshError;
      }

      if (sessionData.session?.user) {
        logger.debug('[Auth Debug] Session refreshed, new user metadata:', sessionData.session.user.user_metadata);
        this.handleAuthChange(sessionData.session.user);
      }

      // Wait a moment for the JWT to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      return data;
    } catch (error) {
      logger.error('[Auth Error] Unexpected error syncing tenant:', error);
      throw error;
    }
  }
}
