import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/notifications/send-sms';
  logs = signal<NotificationLog[]>([]);

  async sendSMS(to: string, message: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; mocked?: boolean }>(this.apiUrl, { to, message })
      );

      const success = response.success;
      const newLog: NotificationLog = {
        id: Math.random().toString(36).substring(7),
        recipient: to,
        message,
        timestamp: new Date(),
        status: success ? 'SENT' : 'FAILED'
      };

      this.logs.update(prev => [newLog, ...prev]);

      if (response.mocked) {
        console.log(`[Twilio Mock - Backend] No credentials found, logged SMS: ${message}`);
      }

      return success;
    } catch (error) {
      console.error('Failed to send SMS:', error);
      return false;
    }
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
    // Replace with a real phone number for the baker in a real production scenario
    const bakerPhone = '+15550123456';
    return this.sendSMS(bakerPhone, message);
  }
}
