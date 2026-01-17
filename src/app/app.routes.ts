import { Routes } from '@angular/router';
import { RecipeCalculatorComponent } from './components/recipe-calculator/recipe-calculator';
import { StorefrontComponent } from './components/storefront/storefront';
import { CartComponent } from './components/cart/cart';
import { ProfileComponent } from './components/profile/profile';
import { ExperimentalKitchenComponent } from './components/experimental-kitchen/experimental-kitchen';
import { LoginComponent } from './components/login/login';
import { RegisterComponent } from './components/register/register';
import { AboutComponent } from './components/about/about';

export const routes: Routes = [
  { path: '', redirectTo: 'store', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'about', component: AboutComponent },
  { path: 'calculator', component: RecipeCalculatorComponent },
  { path: 'calculator/:id', component: RecipeCalculatorComponent },
  { path: 'store', component: StorefrontComponent },
  { path: 'experimental', component: ExperimentalKitchenComponent },
  { path: 'cart', component: CartComponent },
  { path: 'profile', component: ProfileComponent }
];
