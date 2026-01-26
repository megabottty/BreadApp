import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TenantService } from '../../services/tenant.service';
import { DomSanitizer } from '@angular/platform-browser';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './footer.html',
  styleUrls: ['./footer.css']
})
export class FooterComponent {
  tenantService = inject(TenantService);
  private sanitizer = inject(DomSanitizer);

  contactName = signal('');
  contactEmail = signal('');
  contactMessage = signal('');
  isSubmitting = signal(false);
  submitSuccess = signal(false);

  mapUrl = computed(() => {
    const address = this.tenantService.tenant()?.address;
    if (!address) {
      // Default placeholder if no address is set
      return this.sanitizer.bypassSecurityTrustResourceUrl(
        'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.142293761308!2d-73.98731968459391!3d40.75889497932681!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c25855c6480293%3A0x5119f4441db10b28!2sTimes%20Square!5e0!3m2!1sen!2sus!4v1625687232348!5m2!1sen!2sus'
      );
    }
    const encodedAddress = encodeURIComponent(address);
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://www.google.com/maps/embed/v1/place?key=YOUR_API_KEY_HERE&q=${encodedAddress}`
    );
  });

  // Since we don't have a Google Maps API Key easily available for the user,
  // let's use the iframe search approach which is free and doesn't require a key
  displayMapUrl = computed(() => {
    const address = this.tenantService.tenant()?.address;
    if (!address) {
       return this.sanitizer.bypassSecurityTrustResourceUrl(
        'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3022.142293761308!2d-73.98731968459391!3d40.75889497932681!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c25855c6480293%3A0x5119f4441db10b28!2sTimes%20Square!5e0!3m2!1sen!2sus!4v1625687232348!5m2!1sen!2sus'
      );
    }
    // Using the free embed search URL
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=13&ie=UTF8&iwloc=&output=embed`
    );
  });

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
