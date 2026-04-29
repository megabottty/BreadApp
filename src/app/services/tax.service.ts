import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { TenantService } from './tenant.service';

export interface TaxSettings {
  id?: string;
  tenant_id: string;
  sales_tax_rate: number; // As percentage (e.g., 8.5 for 8.5%)
  tax_id_number?: string; // EIN or business tax ID
  collect_sales_tax: boolean;
  tax_exempt_categories?: string[]; // Categories that are tax exempt
  state: string;
  locality?: string;
  updated_at?: string;
}

export interface TaxReport {
  period_start: string;
  period_end: string;
  total_sales: number;
  taxable_sales: number;
  tax_exempt_sales: number;
  total_tax_collected: number;
  order_count: number;
  breakdown_by_category?: {
    category: string;
    sales: number;
    tax: number;
  }[];
}

export interface Expense {
  id?: string;
  tenant_id: string;
  amount: number;
  category: 'INGREDIENTS' | 'LABOR' | 'RENT' | 'UTILITIES' | 'EQUIPMENT' | 'MARKETING' | 'OTHER';
  description: string;
  date: string;
  vendor?: string;
  receipt_url?: string;
  is_deductible: boolean;
  created_at?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TaxService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);

  taxSettings = signal<TaxSettings | null>(null);

  private get headers() {
    const tenantId = this.tenantService.tenant()?.id;
    const slug = this.tenantService.tenant()?.slug;
    if (!tenantId || !slug) return new HttpHeaders();
    return new HttpHeaders()
      .set('x-tenant-id', tenantId)
      .set('x-tenant-slug', slug);
  }

  /**
   * Calculate sales tax for a given amount
   */
  calculateTax(subtotal: number, category?: string): number {
    const settings = this.taxSettings();
    if (!settings || !settings.collect_sales_tax) return 0;

    // Check if category is tax exempt
    if (category && settings.tax_exempt_categories?.includes(category)) {
      return 0;
    }

    return (subtotal * settings.sales_tax_rate) / 100;
  }

  /**
   * Load tax settings for current tenant
   */
  loadTaxSettings() {
    const tenantId = this.tenantService.tenant()?.id;
    if (!tenantId) return;

    this.http.get<TaxSettings>(`${environment.apiUrl}/tax/settings`, {
      headers: this.headers
    }).subscribe({
      next: (settings) => this.taxSettings.set(settings),
      error: (_err) => {
        console.warn('No tax settings found, using defaults');
        // Set default settings
        this.taxSettings.set({
          tenant_id: tenantId,
          sales_tax_rate: 0,
          collect_sales_tax: false,
          state: 'CA'
        });
      }
    });
  }

  /**
   * Update tax settings
   */
  updateTaxSettings(settings: Partial<TaxSettings>) {
    return this.http.patch<TaxSettings>(
      `${environment.apiUrl}/tax/settings`,
      settings,
      { headers: this.headers }
    );
  }

  /**
   * Generate tax report for a date range
   */
  generateTaxReport(startDate: string, endDate: string) {
    return this.http.get<TaxReport>(`${environment.apiUrl}/tax/report`, {
      headers: this.headers,
      params: { start: startDate, end: endDate }
    });
  }

  /**
   * Add a business expense
   */
  addExpense(expense: Omit<Expense, 'id' | 'tenant_id' | 'created_at'>) {
    const tenantId = this.tenantService.tenant()?.id;
    if (!tenantId) throw new Error('No tenant selected');

    return this.http.post<Expense>(
      `${environment.apiUrl}/expenses`,
      { ...expense, tenant_id: tenantId },
      { headers: this.headers }
    );
  }

  /**
   * Get all expenses for a date range
   */
  getExpenses(startDate?: string, endDate?: string) {
    const params: any = {};
    if (startDate) params.start = startDate;
    if (endDate) params.end = endDate;

    return this.http.get<Expense[]>(`${environment.apiUrl}/expenses`, {
      headers: this.headers,
      params
    });
  }

  /**
   * Delete an expense
   */
  deleteExpense(expenseId: string) {
    return this.http.delete(`${environment.apiUrl}/expenses/${expenseId}`, {
      headers: this.headers
    });
  }

  /**
   * Get tax deduction summary
   */
  getTaxDeductionSummary(year: number) {
    return this.http.get<{
      total_deductible_expenses: number;
      breakdown_by_category: { category: string; amount: number }[];
      estimated_tax_savings: number;
    }>(`${environment.apiUrl}/tax/deductions/${year}`, {
      headers: this.headers
    });
  }
}
