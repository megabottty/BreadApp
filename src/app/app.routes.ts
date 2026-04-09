import { Routes } from '@angular/router';
import { authGuard, bakerGuard, guestGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'front', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./components/login/login').then(m => m.LoginComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'register',
    loadComponent: () => import('./components/register/register').then(m => m.RegisterComponent),
    canActivate: [guestGuard]
  },
  {
    path: 'setup-wizard',
    loadComponent: () => import('./components/setup-wizard/setup-wizard').then(m => m.SetupWizardComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'about',
    loadComponent: () => import('./components/about/about').then(m => m.AboutComponent)
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./components/baker-dashboard/baker-dashboard').then(m => m.BakerDashboardComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'calculator',
    loadComponent: () => import('./components/recipe-calculator/recipe-calculator').then(m => m.RecipeCalculatorComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'calculator/:id',
    loadComponent: () => import('./components/recipe-calculator/recipe-calculator').then(m => m.RecipeCalculatorComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'manage-orders',
    loadComponent: () => import('./components/orders-manager/orders-manager').then(m => m.OrdersManagerComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'ledger',
    loadComponent: () => import('./components/bakery-ledger/bakery-ledger').then(m => m.BakeryLedgerComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'pos',
    loadComponent: () => import('./components/pos-terminal/pos-terminal').then(m => m.PosTerminalComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'prep-timeline',
    loadComponent: () => import('./components/prep-timeline/prep-timeline').then(m => m.PrepTimelineComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'ingredients',
    loadComponent: () => import('./components/ingredient-manager/ingredient-manager').then(m => m.IngredientManagerComponent),
    canActivate: [bakerGuard]
  },
  {
    path: 'front',
    loadComponent: () => import('./components/storefront/storefront').then(m => m.StorefrontComponent)
  },
  {
    path: 'cart',
    loadComponent: () => import('./components/cart/cart').then(m => m.CartComponent)
  },
  {
    path: 'order-success/:orderId',
    loadComponent: () => import('./components/order-confirmation/order-confirmation').then(m => m.OrderConfirmationComponent)
  },
  {
    path: 'profile',
    loadComponent: () => import('./components/profile/profile').then(m => m.ProfileComponent),
    canActivate: [authGuard]
  },
  {
    path: 'subscriptions',
    loadComponent: () => import('./components/subscription-manager/subscription-manager').then(m => m.SubscriptionManagerComponent),
    canActivate: [authGuard]
  }
];
