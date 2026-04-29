import { Component, inject, signal, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalService } from '../../services/modal.service';
import { CartService, PackOption } from '../../services/cart.service';

@Component({
  selector: 'app-product-customization-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-customization-modal.html',
  styleUrls: ['./product-customization-modal.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProductCustomizationModalComponent {
  modalService = inject(ModalService);
  cartService = inject(CartService);

  notes = signal<string>('');
  quantity = signal<number>(1);
  packOptions = signal<PackOption[]>([]);
  selectedPackId = signal<string>('');

  // Fetch add-ons from product data
  getAddOns() {
    const product = this.modalService.activeModal()?.product;
    if (!product) return [];

    const productName = (product.name || '').toLowerCase();
    const isMonkeyBread = productName.includes('monkey');

    let addons: any[] = [];

    // 1. If the database has add-ons for this recipe, use them
    if (product.available_addons && product.available_addons.length > 0) {
      addons = product.available_addons.map(addon => ({
        ...addon,
        selected: false
      }));
    }
    // 2. Otherwise use fallback logic based on category/name
    else {
      if (productName.includes('roll')) {
        addons = [
          { name: 'Extra Frosting', price: 1.50, selected: false },
          { name: 'Warm it up', price: 0, selected: false }
        ];
      } else if (product.category === 'BREAD' || productName.includes('bread') || productName.includes('loaf')) {
        addons = [
          { name: 'Sliced', price: 2.00, selected: false },
          { name: 'Double Baked (Extra Crusty)', price: 1.00, selected: false }
        ];
      }
    }

    // 3. Special rule: Monkey Bread should never have slicing or double baked options
    if (isMonkeyBread) {
      addons = addons.filter(addon => {
        const addonName = (addon.name || '').toLowerCase();
        const isForbidden =
          addonName.includes('slice') ||
          addonName.includes('baked') ||
          addonName.includes('crunchy') ||
          addonName.includes('crusty');
        return !isForbidden;
      });
    }

    return addons;
  }

  addOns = signal<any[]>(this.getAddOns());

  // We use an effect to initialize add-ons when the modal opens
  constructor() {
    effect(() => {
      const modal = this.modalService.activeModal();
      if (modal?.type === 'customization' && modal.product) {
        // Reset state every time the modal is opened with a product
        this.addOns.set(this.getAddOns());
        const product = modal.product;
        const options = this.cartService.getPackOptions(product);
        this.packOptions.set(options);
        this.selectedPackId.set(options[0]?.id || '');
        this.notes.set('');
        this.quantity.set(1);
      }
    });
  }


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

      const packOption = this.packOptions().find(option => option.id === this.selectedPackId()) || undefined;
      this.cartService.addToCart(
        modal.product,
        this.quantity(),
        this.notes(),
        selectedOptions,
        packOption
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
