import { Injectable, signal } from '@angular/core';

export interface ModalConfig {
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

@Injectable({
  providedIn: 'root'
})
export class ModalService {
  activeModal = signal<ModalConfig | null>(null);

  showAlert(message: string, title: string = 'Notice', type: ModalConfig['type'] = 'info') {
    this.activeModal.set({ title, message, type });
  }

  close() {
    this.activeModal.set(null);
  }
}
