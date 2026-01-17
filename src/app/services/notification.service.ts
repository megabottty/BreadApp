import { Injectable, signal } from '@angular/core';

export interface NotificationLog {
  id: string;
  recipient: string;
  message: string;
  timestamp: Date;
  status: 'SENT' | 'FAILED';
}

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  logs = signal<NotificationLog[]>([]);

  async sendSMS(to: string, message: string): Promise<boolean> {
    console.log(`[Twilio Mock] Sending SMS to ${to}: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 800));
    const success = true;
    const newLog: NotificationLog = {
      id: Math.random().toString(36).substring(7),
      recipient: to,
      message,
      timestamp: new Date(),
      status: success ? 'SENT' : 'FAILED'
    };
    this.logs.update(prev => [newLog, ...prev]);
    return success;
  }

  async sendOrderConfirmation(customerName: string, phone: string, orderId: string) {
    const message = `Hi ${customerName}, thanks for your order from The Daily Dough! Your order ID is #${orderId}. We'll notify you when it's ready.`;
    return this.sendSMS(phone, message);
  }

  async sendReadyForPickup(customerName: string, phone: string) {
    const message = `Hi ${customerName}, your Daily Dough order is fresh out of the oven and ready for pickup! 🥖`;
    return this.sendSMS(phone, message);
  }

  async sendOutForDelivery(customerName: string, phone: string, trackingUrl?: string) {
    const tracking = trackingUrl ? ` Track it here: ${trackingUrl}` : '';
    const message = `Hi ${customerName}, your Daily Dough order is out for delivery! 🚚${tracking}`;
    return this.sendSMS(phone, message);
  }

  async sendBakerOrderAlert(orderId: string, customerName: string) {
    const message = `[BAKER ALERT] New order #${orderId} received from ${customerName}! Get the ovens ready. 🍞`;
    console.log(`[Notification Service] ${message}`);
    // In a real app, this would send an SMS or email to the baker
    return true;
  }
}
