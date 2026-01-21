import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrdersManagerComponent } from '../orders-manager/orders-manager';
import { BakeryLedgerComponent } from '../bakery-ledger/bakery-ledger';
import { RecipeCalculatorComponent } from '../recipe-calculator/recipe-calculator';
import { TenantService } from '../../services/tenant.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-baker-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OrdersManagerComponent,
    BakeryLedgerComponent,
    RecipeCalculatorComponent
  ],
  templateUrl: './baker-dashboard.html',
  styleUrls: ['./baker-dashboard.css']
})
export class BakerDashboardComponent {
  private tenantService = inject(TenantService);

  activeTab = signal<'orders' | 'ledger' | 'recipes' | 'settings'>('orders');
  currentTenant = this.tenantService.tenant;

  updateBranding(colors: { primary: string, secondary: string }) {
    // Logic to save new colors to backend
    console.log('Updating branding:', colors);
  }
}
