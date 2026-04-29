import { Component, inject, signal, computed, AfterViewInit } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../services/tenant.service';
import { Router } from '@angular/router';
import { ModalService } from '../../services/modal.service';
import { environment } from '../../../environments/environment';
import { StripeLoaderService } from '../../services/stripe-loader.service';

import { firstValueFrom } from 'rxjs';
import { HttpClient } from '@angular/common/http';

interface Plan {
  id: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  name: string;
  price: number;
  features: string[];
  stripePriceId: string;
}

@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './setup-wizard.html',
  styleUrls: ['./setup-wizard.css']
})
export class SetupWizardComponent implements AfterViewInit {
  private tenantService = inject(TenantService);
  private router = inject(Router);
  private modalService = inject(ModalService);
  private helpService = inject(HelpService);
  private http = inject(HttpClient);
  private stripeLoader = inject(StripeLoaderService);

  currentStep = signal(1);
  totalSteps = 5;

  // Step 1: Business Type
  businessType = signal<'BAKERY' | 'RETAIL' | 'RESTAURANT'>('BAKERY');

  // Step 2: Branding
  primaryColor = signal('#7D8F69');
  secondaryColor = signal('#D88569');

  // Step 2: Oven
  ovenCapacity = signal(6);

  // Step 3: Location & Contact
  address = signal('');
  phone = signal('');
  email = signal('');

  // Step 4: Plan Selection
  selectedPlan = signal<'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'>('STARTER');
  isProcessingPayment = signal(false);
  isTestMode = computed(() => environment.stripePublicKey.startsWith('pk_test'));

  // Stripe Elements
  private stripe: any;
  private card: any;
  stripeError = signal<string | null>(null);
  isCardComplete = signal(false);

  plans: Plan[] = [
    {
      id: 'STARTER',
      name: 'Starter Baker',
      price: 29,
      features: [
        'Up to 50 active recipes',
        'Automatic Inventory Tracking',
        'Email Order Notifications',
        'Direct Online Payments (Stripe)',
        'Custom Shop Branding (Colors)',
        'Standard Email Support'
      ],
      stripePriceId: 'price_starter_id'
    },
    {
      id: 'PROFESSIONAL',
      name: 'Professional Baker',
      price: 79,
      features: [
        'Unlimited Recipes',
        'Advanced Inventory + PO Generation',
        'Revenue & Profit Analytics',
        'SMS Customer Notifications',
        'Priority Email Support',
        'Custom Domain Support'
      ],
      stripePriceId: 'price_professional_id'
    },
    {
      id: 'ENTERPRISE',
      name: 'Enterprise Bakery',
      price: 199,
      features: [
        'Everything in Professional',
        'Multi-User/Staff Accounts',
        'Multi-Location Management',
        'Toast POS Integration Support',
        'Advanced API Access',
        'Dedicated Success Manager'
      ],
      stripePriceId: 'price_enterprise_id'
    }
  ];

  isStepValid = computed(() => {
    const step = this.currentStep();
    console.log(`[SetupWizard Debug] Validating Step ${step}. CardComplete: ${this.isCardComplete()}, StripeError: ${this.stripeError()}`);
    if (step === 1) return !!this.businessType();
    if (step === 2) return !!this.primaryColor() && !!this.secondaryColor();
    if (step === 3) return this.ovenCapacity() > 0;
    if (step === 4) return !!this.address() && !!this.phone() && !!this.email();
    if (step === 5) {
      // --- UNCOMMENT FOR PRODUCTION ---
      return this.isCardComplete() && !this.stripeError() && !!this.stripe;
    }
    return true;
  });

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

  ngAfterViewInit() {
    // Initialize Stripe once Step 4 is reached (or on init if we want to be ready)
    // Actually, we need the #card-element to exist.
    // Since Step 4 is hidden with @if, we need to initialize when currentStep() === 4
  }

  async initStripe() {
    if (this.stripe) return; // Already init

    try {
      const key = environment.stripePublicKey;

      // DEEP DEBUG LOG FOR USER
      console.log('%c [Stripe Key Audit] ', 'background: #222; color: #bada55; font-size: 14px');
      console.log('Current Key:', key);
      console.log('Is Test Key:', key.startsWith('pk_test'));
      console.log('Is Live Key:', key.startsWith('pk_live'));

      if (!key || key.includes('your_public_key_here')) {
        this.stripeError.set('Stripe Public Key is not configured in environment.ts');
        return;
      }

      const stripeFactory = await this.stripeLoader.loadStripe();
      if (!stripeFactory) {
        this.stripeError.set('Stripe failed to load. Please refresh and try again.');
        return;
      }

      this.stripe = stripeFactory(key);
      console.log('[Stripe Debug] Initializing with key:', key);
      const elements = this.stripe.elements();

      const style = {
        base: {
          color: '#32325d',
          fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
          fontSmoothing: 'antialiased',
          fontSize: '16px',
          '::placeholder': {
            color: '#aab7c4'
          }
        },
        invalid: {
          color: '#fa755a',
          iconColor: '#fa755a'
        }
      };

      this.card = elements.create('card', { style });
      this.card.mount('#card-element');

      this.card.on('change', (event: any) => {
        this.isCardComplete.set(event.complete);
        if (event.error) {
          this.stripeError.set(event.error.message);
        } else {
          this.stripeError.set(null);
        }
      });
    } catch (e) {
      console.error('Stripe initialization failed:', e);
    }
  }

  nextStep() {
    if (this.currentStep() < this.totalSteps) {
      this.currentStep.update(s => s + 1);

      // If moving to step 5, init Stripe
      if (this.currentStep() === 5) {
        setTimeout(() => this.initStripe(), 100);
      }
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
    let tenant = this.tenantService.tenant();
    if (!tenant) {
      // If tenant is missing, try to re-identify it (e.g. from localStorage)
      const savedSlug = localStorage.getItem('bakery_slug');
      if (savedSlug) {
        this.tenantService.loadTenantInfo(savedSlug);
        await new Promise(resolve => setTimeout(resolve, 1000));
        tenant = this.tenantService.tenant();
      }
    }

    if (!tenant) {
      this.modalService.showAlert('No business profile found to update. Please try refreshing the page.', 'Setup Error', 'error');
      return;
    }

    this.isProcessingPayment.set(true);

    try {
      // 1. Create Payment Method with Stripe
      const { paymentMethod, error } = await this.stripe.createPaymentMethod({
        type: 'card',
        card: this.card,
        billing_details: {
          email: this.email() || tenant.email,
          name: tenant.name
        }
      });

      if (error) {
        this.stripeError.set(error.message);
        this.isProcessingPayment.set(false);
        return;
      }

      console.log('[SetupWizard] Stripe PaymentMethod created:', paymentMethod.id);

      // 2. Call Backend to create subscription
      const response = await firstValueFrom(this.http.post<{subscriptionId: string, customerId: string}>(`${environment.apiUrl}/payments/create-subscription`, {
        paymentMethodId: paymentMethod.id,
        planId: this.selectedPlan(),
        email: this.email() || tenant.email,
        tenantId: tenant.id
      }));
      const subscriptionId = response.subscriptionId;
      const _customerId = response.customerId;
      const status = 'TRIAL';

      // 3. Update Business Info
      this.tenantService.updateTenant(tenant.id, {
        business_type: this.businessType(),
        primary_color: this.primaryColor(),
        secondary_color: this.secondaryColor(),
        oven_capacity: this.ovenCapacity(),
        address: this.address(),
        phone: this.phone(),
        email: this.email(),
        subscription_plan: this.selectedPlan(),
        subscription_id: subscriptionId,
        subscription_status: status,
        onboarding_completed: true
      });

      // Update Supabase user metadata
      const { createClient } = await import('@supabase/supabase-js');
      const supabase = createClient(environment.supabaseUrl, environment.supabaseKey);
      await supabase.auth.updateUser({
        data: { onboarding_completed: true }
      });

      this.modalService.showAlert('Your business is now ready! Your 14-day trial has started.', 'Setup Complete', 'success');
      this.router.navigate(['/dashboard']);

    } catch (error: any) {
      console.error('[SetupWizard] Error finishing setup:', error);
      const msg = error.error?.error || 'Failed to process subscription. Please check your card and try again.';
      this.modalService.showAlert(msg, 'Payment Error', 'error');
    } finally {
      this.isProcessingPayment.set(false);
    }
  }

  showHint() {
    const hint = this.helpService.getHint('setup-wizard');
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }
}
