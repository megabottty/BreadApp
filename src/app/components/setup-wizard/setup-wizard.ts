import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../services/tenant.service';
import { Router } from '@angular/router';
import { ModalService } from '../../services/modal.service';

@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './setup-wizard.html',
  styleUrls: ['./setup-wizard.css']
})
export class SetupWizardComponent {
  private tenantService = inject(TenantService);
  private router = inject(Router);
  private modalService = inject(ModalService);

  currentStep = signal(1);
  totalSteps = 4;

  // Step 1: Branding
  primaryColor = signal('#7D8F69');
  secondaryColor = signal('#D88569');

  // Step 2: Oven
  ovenCapacity = signal(6);

  // Step 3: Location & Contact
  address = signal('');
  phone = signal('');
  email = signal('');

  // Step 4: Plan Selection
  selectedPlan = signal<'BASIC' | 'PRO'>('BASIC');

  constructor() {
    // Sync with existing tenant info if available
    const tenant = this.tenantService.tenant();
    if (tenant) {
      this.primaryColor.set(tenant.primary_color);
      this.secondaryColor.set(tenant.secondary_color);
      this.ovenCapacity.set(tenant.oven_capacity || 6);
      this.address.set(tenant.address || '');
      this.phone.set(tenant.phone || '');
      this.email.set(tenant.email || '');
    }
  }

  nextStep() {
    if (this.currentStep() < this.totalSteps) {
      this.currentStep.update(s => s + 1);
    } else {
      this.finish();
    }
  }

  prevStep() {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
    }
  }

  async finish() {
    const tenant = this.tenantService.tenant();
    if (!tenant) {
      this.modalService.showAlert('No bakery profile found to update.', 'Setup Error', 'error');
      return;
    }

    this.tenantService.updateTenant(tenant.id, {
      primary_color: this.primaryColor(),
      secondary_color: this.secondaryColor(),
      oven_capacity: this.ovenCapacity(),
      address: this.address(),
      phone: this.phone(),
      email: this.email(),
      subscription_plan: this.selectedPlan(),
      onboarding_completed: true
    });

    this.modalService.showAlert('Your bakery is now ready! 🥖', 'Setup Complete', 'success');
    this.router.navigate(['/dashboard']);
  }
}
