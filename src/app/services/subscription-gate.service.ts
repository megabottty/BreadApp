import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { ModalService } from './modal.service';

/** Shown wherever a guest tries to subscribe: the storefront Subscribe button,
 * the add-to-bag dialog's weekly option, and the cart. */
export const SUBSCRIPTION_ACCOUNT_TITLE = 'Subscriptions need an account';
export const SUBSCRIPTION_ACCOUNT_MESSAGE =
  'A subscription is a standing weekly order, so we tie it to your account. That is how we link each ' +
  'delivery to you, and how you can pause, skip, or cancel from your profile at any time. ' +
  'Log in or create a free account to subscribe. Your bag will be waiting.';

/**
 * Guards the subscription entry points. A subscription has to belong to a
 * customer record so recurring orders can be linked, managed and cancelled;
 * guests get a short explanation and a way to log in or sign up that brings
 * them back to where they were.
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionGateService {
  private readonly authService = inject(AuthService);
  private readonly modalService = inject(ModalService);
  private readonly router = inject(Router);

  /** True when the current user may subscribe (any signed-in account). */
  canSubscribe(): boolean {
    return this.authService.isAuthenticated();
  }

  /**
   * Explains why an account is needed and offers Log in / Create account.
   * `returnUrl` is where they land after signing in (the cart survives the
   * round-trip since it lives in memory for the SPA session).
   */
  explain(returnUrl: string): void {
    this.modalService.showConfirm(
      SUBSCRIPTION_ACCOUNT_MESSAGE,
      SUBSCRIPTION_ACCOUNT_TITLE,
      () => this.router.navigate(['/login'], { queryParams: { returnUrl } }),
      () => this.router.navigate(['/register'], { queryParams: { role: 'CUSTOMER', returnUrl } }),
      'Log in',
      'Create account'
    );
  }
}
