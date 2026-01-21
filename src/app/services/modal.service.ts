import { Injectable, signal } from '@angular/core';

export interface ModalConfig {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
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

  close() {
    this.activeModal.set(null);
  }
}
