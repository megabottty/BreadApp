import { Injectable, signal } from '@angular/core';

import { CalculatedRecipe } from '../logic/bakers-math';

export interface ModalConfig {
  title: string;
  message?: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'confirm' | 'customization';
  onConfirm?: () => void;
  onCancel?: () => void;
  product?: CalculatedRecipe;
}

@Injectable({
  providedIn: 'root'
})
export class ModalService {
  activeModal = signal<ModalConfig | null>(null);

  showAlert(message: string, title: string = 'Notice', type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    this.activeModal.set({ title, message, type });
  }

  showConfirm(message: string, title: string = 'Confirm', onConfirm?: () => void, onCancel?: () => void) {
    this.activeModal.set({ title, message, type: 'confirm', onConfirm, onCancel });
  }

  showCustomization(product: CalculatedRecipe) {
    this.activeModal.set({
      title: `Customize ${product.name}`,
      type: 'customization',
      product
    });
  }

  close() {
    this.activeModal.set(null);
  }
}
