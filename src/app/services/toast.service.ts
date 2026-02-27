import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  toasts = signal<Toast[]>([]);
  private nextId = 0;

  /**
   * Show a success toast
   */
  success(message: string, duration: number = 3000) {
    this.show(message, 'success', duration);
  }

  /**
   * Show an error toast
   */
  error(message: string, duration: number = 5000) {
    this.show(message, 'error', duration);
  }

  /**
   * Show a warning toast
   */
  warning(message: string, duration: number = 4000) {
    this.show(message, 'warning', duration);
  }

  /**
   * Show an info toast
   */
  info(message: string, duration: number = 3000) {
    this.show(message, 'info', duration);
  }

  /**
   * Show a toast with custom type and duration
   */
  show(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration: number = 3000) {
    const id = `toast-${this.nextId++}`;
    const toast: Toast = { id, message, type, duration };

    this.toasts.update(toasts => [...toasts, toast]);

    // Auto-dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }
  }

  /**
   * Dismiss a specific toast
   */
  dismiss(id: string) {
    this.toasts.update(toasts => toasts.filter(t => t.id !== id));
  }

  /**
   * Clear all toasts
   */
  clearAll() {
    this.toasts.set([]);
  }
}
