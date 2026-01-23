import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalService } from '../../services/modal.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-product-customization-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-customization-modal.html',
  styleUrls: ['./product-customization-modal.css']
})
export class ProductCustomizationModalComponent {
  modalService = inject(ModalService);
  cartService = inject(CartService);

  notes = signal<string>('');
  quantity = signal<number>(1);

  // Fetch add-ons from product data
  getAddOns() {
    const product = this.modalService.activeModal()?.product;
    if (!product) return [];

    // If the database has add-ons for this recipe, use them
    if (product.available_addons && product.available_addons.length > 0) {
      return product.available_addons.map(addon => ({
        ...addon,
        selected: false
      }));
    }

    // Fallback logic for items without DB add-ons
    if (product.name.toLowerCase().includes('roll')) {
      return [
        { name: 'Extra Frosting', price: 1.50, selected: false },
        { name: 'Warm it up', price: 0, selected: false }
      ];
    }

    if (product.name.toLowerCase().includes('bread') || product.name.toLowerCase().includes('loaf')) {
      return [
        { name: 'Sliced', price: 0, selected: false },
        { name: 'Double Baked (Extra Crusty)', price: 0, selected: false }
      ];
    }

    return [];
  }

  addOns = signal<any[]>(this.getAddOns());

  // We use an effect to initialize add-ons when the modal opens with a new product
  constructor() {
    effect(() => {
      const modal = this.modalService.activeModal();
      if (modal?.type === 'customization' && modal.product) {
        const product = modal.product;
        // Only reset if it's a different product than last time
        if (product.id !== this.lastProductId) {
          this.addOns.set(this.getAddOns());
          this.lastProductId = product.id;
          this.notes.set('');
          this.quantity.set(1);
        }
      }
    });
  }

  private lastProductId: string | undefined;

  // This method is no longer called from the template to avoid NG0600
  updateAddOns() {
    // Keep for legacy/internal use if needed, but not in template
  }

  toggleAddOn(index: number) {
    this.addOns.update(prev => {
      const next = [...prev];
      next[index] = { ...next[index], selected: !next[index].selected };
      return next;
    });
  }

  close() {
    this.modalService.close();
  }

  addToCart() {
    const modal = this.modalService.activeModal();
    if (modal?.product) {
      const selectedOptions = this.addOns()
        .filter(a => a.selected)
        .map(a => ({ name: a.name, price: a.price }));

      this.cartService.addToCart(
        modal.product,
        this.quantity(),
        this.notes(),
        selectedOptions
      );
      this.close();
    }
  }

  increment() {
    this.quantity.update(q => q + 1);
  }

  decrement() {
    this.quantity.update(q => Math.max(1, q - 1));
  }
}
