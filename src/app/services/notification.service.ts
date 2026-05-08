import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { logger } from '../utils/logger';

import { ModalService } from './modal.service';

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
  private modalService = inject(ModalService);
  private smsApiUrl = environment.apiUrl + '/notifications/send-sms';
  private emailApiUrl = environment.apiUrl + '/notifications/send-email';
  logs = signal<NotificationLog[]>([]);

  async sendSMS(to: string, message: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; mocked?: boolean }>(this.smsApiUrl, { to, message })
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
        logger.info(`[Twilio Mock - Backend] No credentials found, logged SMS: ${message}`);
      }

      return success;
    } catch (error) {
      logger.error('Failed to send SMS:', error);
      return false;
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; mocked?: boolean }>(this.emailApiUrl, { to, subject, html })
      );

      const success = response.success;
      const newLog: NotificationLog = {
        id: Math.random().toString(36).substring(7),
        recipient: to,
        message: subject,
        timestamp: new Date(),
        status: success ? 'SENT' : 'FAILED'
      };

      this.logs.update(prev => [newLog, ...prev]);

      if (response.mocked) {
        logger.info(`[Email Mock - Backend] No SMTP configured, logged email: ${subject}`);
      }

      return success;
    } catch (error) {
      logger.error('Failed to send email:', error);
      return false;
    }
  }

  private shouldSendSms(preference?: 'SMS' | 'EMAIL' | 'BOTH' | 'NONE') {
    return preference === 'SMS' || preference === 'BOTH' || preference === undefined;
  }

  private shouldSendEmail(preference?: 'SMS' | 'EMAIL' | 'BOTH' | 'NONE') {
    return preference === 'EMAIL' || preference === 'BOTH';
  }

  async sendOrderConfirmation(customerName: string, phone: string, email: string, orderId: string, preference?: 'SMS' | 'EMAIL' | 'BOTH' | 'NONE') {
    const message = `Hi ${customerName}, thanks for your order from The Daily Dough! Your order ID is #${orderId}. We'll notify you when it's ready.`;
    const emailSubject = `Order confirmation #${orderId}`;
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7D8F69;">Thanks for your order!</h2>
        <p>Hi ${customerName},</p>
        <p>We received your order. Your confirmation number is <strong>#${orderId}</strong>.</p>
        <p>We'll let you know as soon as it's ready.</p>
      </div>
    `;

    if (this.shouldSendSms(preference) && phone) {
      await this.sendSMS(phone, message);
    }
    if (this.shouldSendEmail(preference) && email) {
      await this.sendEmail(email, emailSubject, emailHtml);
    }
  }

  async sendReadyForPickup(customerName: string, phone: string, email: string, preference?: 'SMS' | 'EMAIL' | 'BOTH' | 'NONE') {
    const message = `Hi ${customerName}, your Daily Dough order is fresh out of the oven and ready for pickup! 🥖`;
    const emailSubject = 'Your order is ready for pickup';
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7D8F69;">Your order is ready!</h2>
        <p>Hi ${customerName},</p>
        <p>Your Daily Dough order is fresh out of the oven and ready for pickup.</p>
      </div>
    `;

    if (this.shouldSendSms(preference) && phone) {
      await this.sendSMS(phone, message);
    }
    if (this.shouldSendEmail(preference) && email) {
      await this.sendEmail(email, emailSubject, emailHtml);
    }
  }

  async sendOutForDelivery(customerName: string, phone: string, email: string, trackingUrl?: string, preference?: 'SMS' | 'EMAIL' | 'BOTH' | 'NONE') {
    const tracking = trackingUrl ? ` Track it here: ${trackingUrl}` : '';
    const message = `Hi ${customerName}, your Daily Dough order is out for delivery! 🚚${tracking}`;
    const emailSubject = 'Your order is out for delivery';
    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #7D8F69;">On its way!</h2>
        <p>Hi ${customerName},</p>
        <p>Your Daily Dough order is out for delivery.${trackingUrl ? ` Track it here: <a href="${trackingUrl}">${trackingUrl}</a>` : ''}</p>
      </div>
    `;

    if (this.shouldSendSms(preference) && phone) {
      await this.sendSMS(phone, message);
    }
    if (this.shouldSendEmail(preference) && email) {
      await this.sendEmail(email, emailSubject, emailHtml);
    }
  }

  async sendBakerOrderAlert(orderId: string, customerName: string) {
    const message = `[BAKER ALERT] New order #${orderId} received from ${customerName}! Get the ovens ready. 🍞`;
    // Replace with a real phone number for the baker in a real production scenario
    const bakerPhone = '+15550123456';
    return this.sendSMS(bakerPhone, message);
  }

  /**
   * Alias for modalService.showAlert to maintain compatibility with legacy code
   * or simplified API expectations.
   */
  show(message: string, title: string = 'Notification', type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    this.modalService.showAlert(message, title, type);
  }
}
