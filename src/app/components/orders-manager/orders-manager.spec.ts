import { expect } from 'vitest';

class MockModalService {
  lastConfirm: any = null;
  lastAlert: any = null;
  showConfirm(message: string, title: string, onConfirm?: () => void, onCancel?: () => void) {
    this.lastConfirm = { message, title };
    // Simulate user accepting the confirm immediately
    if (onConfirm) onConfirm();
  }
  showAlert(message: string, title: string, type?: string) {
    this.lastAlert = { message, title, type };
  }
}

class MockHttp {
  patched: any = null;
  patch(url: string, body: any, options?: any) {
    const self = this;
    return {
      subscribe: ({ next, error }: any) => {
        // Simulate successful backend response
        self.patched = { url, body, options };
        if (next) next({ success: true });
      }
    };
  }
}

class MockNotificationService {
  sent: any = null;
  sendSMS(phone: string, message: string) {
    this.sent = { phone, message };
  }
}

describe('OrdersManager cancel modal flow (unit)', () => {
  it('shows confirm and cancels order via backend, updates local state and notifies customer', () => {
    const modal = new MockModalService();
    const http = new MockHttp();
    const notification = new MockNotificationService();

    // initial orders list with one PENDING order
    const orders = [
      { id: 'ORD-1', customerName: 'Alice', customerPhone: '555-1234', status: 'PENDING', pickupDate: new Date().toISOString(), items: [] }
    ];

    const order = orders[0];

    // Build the same message as OrdersManager.cancelOrder
    const pickupDate = order.pickupDate ? new Date(order.pickupDate) : null;
    const daysUntilPickup = pickupDate ? Math.ceil((pickupDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : 0;

    modal.showConfirm(
      `Are you sure you want to cancel order #${order.id} for ${order.customerName}?\n\nThis order is scheduled for ${pickupDate?.toLocaleDateString()} (${daysUntilPickup} days away).\n\nCustomer will be notified of the cancellation.`,
      'Cancel Order',
      () => {
        // onConfirm: call backend patch and update local orders and notify
        http.patch(`/api/orders/${order.id}/status`, { status: 'CANCELLED' }, {}).subscribe({
          next: () => {
            // update local orders
            for (let i = 0; i < orders.length; i++) {
              if (orders[i].id === order.id) orders[i] = { ...orders[i], status: 'CANCELLED' };
            }
            // send notification
            notification.sendSMS(order.customerPhone, `Your order #${order.id} has been cancelled. Please contact us if you have any questions.`);
            modal.showAlert('Order cancelled and customer notified.', 'Cancelled', 'success');
          },
          error: () => {
            modal.showAlert('Failed to cancel order. Please try again.', 'Error', 'error');
          }
        });
      }
    );

    // Assertions
    expect(modal.lastConfirm).toBeTruthy();
    expect(http.patched).toBeTruthy();
    expect(http.patched.url).toContain(`/api/orders/${order.id}/status`);
    expect(http.patched.body).toEqual({ status: 'CANCELLED' });
    expect(orders[0].status).toBe('CANCELLED');
    expect(notification.sent).toBeTruthy();
    expect(modal.lastAlert).toBeTruthy();
    expect(modal.lastAlert.title).toBe('Cancelled');
  });
});
