import { Routes } from '@angular/router';
import { RecipeCalculatorComponent } from './components/recipe-calculator/recipe-calculator';
import { StorefrontComponent } from './components/storefront/storefront';
import { CartComponent } from './components/cart/cart';
import { ProfileComponent } from './components/profile/profile';
import { ExperimentalKitchenComponent } from './components/experimental-kitchen/experimental-kitchen';
import { OrdersManagerComponent } from './components/orders-manager/orders-manager';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { AboutComponent } from './components/about/about';
import { BakeryLedgerComponent } from './components/bakery-ledger/bakery-ledger';
import { SubscriptionManagerComponent } from './components/subscription-manager/subscription-manager';
import { authGuard, bakerGuard } from './guards/auth.guard';

import { OrderConfirmationComponent } from './components/order-confirmation/order-confirmation';

export const routes: Routes = [
  { path: '', redirectTo: 'front', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'about', component: AboutComponent },
  {
    path: 'calculator',
    component: RecipeCalculatorComponent,
    canActivate: [bakerGuard]
  },
  {
    path: 'calculator/:id',
    component: RecipeCalculatorComponent,
    canActivate: [bakerGuard]
  },
  {
    path: 'manage-orders',
    component: OrdersManagerComponent,
    canActivate: [bakerGuard]
  },
  {
    path: 'ledger',
    component: BakeryLedgerComponent,
    canActivate: [bakerGuard]
  },
  { path: 'front', component: StorefrontComponent },
  { path: 'experimental', component: ExperimentalKitchenComponent },
  { path: 'cart', component: CartComponent },
  { path: 'order-success/:orderId', component: OrderConfirmationComponent },
  {
    path: 'profile',
    component: ProfileComponent,
    canActivate: [authGuard]
  },
  {
    path: 'subscriptions',
    component: SubscriptionManagerComponent,
    canActivate: [authGuard]
  }
];
