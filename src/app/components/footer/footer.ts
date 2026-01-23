import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './footer.html',
  styleUrls: ['./footer.css']
})
export class FooterComponent {
  tenantService = inject(TenantService);

  contactName = signal('');
  contactEmail = signal('');
  contactMessage = signal('');
  isSubmitting = signal(false);
  submitSuccess = signal(false);

  submitContactForm() {
    if (!this.contactName() || !this.contactEmail() || !this.contactMessage()) return;

    this.isSubmitting.set(true);

    // Simulate API call
    setTimeout(() => {
      console.log('Contact form submitted:', {
        name: this.contactName(),
        email: this.contactEmail(),
        message: this.contactMessage()
      });
      this.isSubmitting.set(false);
      this.submitSuccess.set(true);

      // Reset form
      this.contactName.set('');
      this.contactEmail.set('');
      this.contactMessage.set('');

      // Clear success message after 5 seconds
      setTimeout(() => this.submitSuccess.set(false), 5000);
    }, 1500);
  }
}
