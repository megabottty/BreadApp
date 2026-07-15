import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { RuntimeConfigService } from '../services/runtime-config.service';

export const authGuard: CanActivateFn = async (route, state) => {
  // Bypass guards when running E2E tests via query param
  if (typeof window !== 'undefined' && window.location.search.includes('e2e=1')) return true;

  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.waitForAuthReady();

  if (authService.isAuthenticated()) {
    return true;
  }

  // Redirect to login if not authenticated
  router.navigate(['/login'], { queryParams: { returnUrl: state.url } });
  return false;
};

export const bakerGuard: CanActivateFn = async (_route, _state) => {
  // Bypass guards when running E2E tests via query param
  if (typeof window !== 'undefined' && window.location.search.includes('e2e=1')) return true;

  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.waitForAuthReady();

  if (authService.isAuthenticated() && authService.isBaker()) {
    return true;
  }

  router.navigate(['/front']);
  return false;
};

export const guestGuard: CanActivateFn = async (_route, _state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.waitForAuthReady();

  if (authService.isAuthenticated()) {
    const user = authService.user();
    if (user?.role === 'BAKER') {
      router.navigate(['/dashboard']);
    } else {
      router.navigate(['/front']);
    }
    return false;
  }

  return true;
};

export const storefrontAdminGuard: CanActivateFn = async (_route, _state) => {
  // Bypass guards when running E2E tests via query param
  if (typeof window !== 'undefined' && window.location.search.includes('e2e=1')) return true;

  const authService = inject(AuthService);
  const runtimeConfig = inject(RuntimeConfigService);
  const router = inject(Router);
  await authService.waitForAuthReady();

  if (runtimeConfig.isPublicMode()) {
    return true;
  }

  if (authService.isAuthenticated() && authService.isBaker()) {
    return true;
  }

  router.navigate(['/under-construction']);
  return false;
};
