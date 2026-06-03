import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { TenantService } from '../../services/tenant.service';
import { ModalService } from '../../services/modal.service';

interface IngredientCost {
  name: string;
  bulkPrice?: number;
  bulkWeight?: number;
  costPerUnit?: number;
}

@Component({
  selector: 'app-ingredient-manager',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="manager-container">
      <header class="section-header">
        <h2>Product Prices & Ingredients</h2>
        <p>Manage the bulk prices and weights for your ingredients. These will be automatically applied in the Recipe Calculator.</p>
      </header>

      <div class="actions-bar">
        <button class="btn-primary" (click)="addIngredient()">+ Add New Product</button>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ingredient Name</th>
              <th>Bulk Price ($)</th>
              <th>Bulk Weight (g)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (item of ingredients(); track item.name; let i = $index) {
              <tr>
                <td>
                  <input type="text" [(ngModel)]="item.name" placeholder="Flour, Salt, etc.">
                </td>
                <td>
                  <input type="number" [(ngModel)]="item.bulkPrice" placeholder="0.00">
                </td>
                <td>
                  <input type="number" [(ngModel)]="item.bulkWeight" placeholder="0">
                </td>
                <td class="actions">
                  <button class="btn-icon delete" (click)="removeIngredient(i)" title="Remove">×</button>
                </td>
              </tr>
            }
            @if (ingredients().length === 0) {
              <tr>
                <td colspan="4" class="empty-state">No products added yet. Click "+ Add New Product" to start.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="footer-actions">
        <button class="btn-save" (click)="saveAll()">Save All Prices</button>
      </div>
    </div>
  `,
  styles: [`
    .manager-container {
      padding: 2rem;
      max-width: 1000px;
      margin: 0 auto;
    }
    .section-header {
      margin-bottom: 2rem;
    }
    .section-header h2 {
      margin-bottom: 0.5rem;
      color: var(--text-primary);
    }
    .section-header p {
      color: var(--text-secondary);
    }
    .actions-bar {
      margin-bottom: 1rem;
      display: flex;
      justify-content: flex-end;
    }
    .table-container {
      background: var(--card-bg);
      border-radius: 8px;
      box-shadow: 0 2px 8px var(--shadow-color);
      overflow: hidden;
      margin-bottom: 2rem;
      border: 1px solid var(--border-color);
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
    }
    .data-table th, .data-table td {
      padding: 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-primary);
    }
    .data-table th {
      background: var(--btn-secondary);
      font-weight: 600;
      color: var(--text-secondary);
    }
    .data-table input {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--input-bg);
      color: var(--text-primary);
    }
    .btn-icon.delete {
      background: none;
      border: none;
      color: var(--color-error, #ff4444);
      font-size: 1.5rem;
      cursor: pointer;
      line-height: 1;
    }
    .footer-actions {
      display: flex;
      justify-content: center;
    }
    .btn-primary, .btn-save {
      background: var(--color-accent, #e67e22);
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-primary:hover, .btn-save:hover {
      opacity: 0.9;
    }
    .empty-state {
      text-align: center;
      color: var(--color-text-secondary);
      padding: 3rem !important;
    }
  `]
})
export class IngredientManagerComponent implements OnInit {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);
  private modalService = inject(ModalService);

  ingredients = signal<IngredientCost[]>([]);

  ngOnInit() {
    this.loadIngredientCosts();
  }

  private get headers(): HttpHeaders | null {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return null;
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  loadIngredientCosts() {
    const headers = this.headers;
    if (!headers) return;

    this.http.get<IngredientCost[]>(
      `${environment.apiUrl}/orders/ingredients/costs`,
      { headers }
    ).subscribe({
      next: (costs) => {
        // Filter out duplicates based on normalized name
        const unique = new Map<string, IngredientCost>();
        costs.forEach(c => {
          const name = c.name.trim();
          if (!unique.has(name.toLowerCase())) {
            unique.set(name.toLowerCase(), { ...c, name });
          }
        });
        this.ingredients.set(Array.from(unique.values()));
      },
      error: (err) => console.error('Failed to load costs', err)
    });
  }

  addIngredient() {
    this.ingredients.update(prev => [
      ...prev,
      { name: '', bulkPrice: 0, bulkWeight: 0 }
    ]);
  }

  removeIngredient(index: number) {
    this.ingredients.update(prev => prev.filter((_, i) => i !== index));
  }

  saveAll() {
    const headers = this.headers;
    if (!headers) return;

    const payload = this.ingredients()
      .filter(ing => ing.name.trim() !== '')
      .map(ing => ({
        name: ing.name.trim(),
        bulkPrice: ing.bulkPrice || null,
        bulkWeight: ing.bulkWeight || null,
        costPerUnit: ing.costPerUnit || null
      }));

    this.http.post(`${environment.apiUrl}/orders/ingredients/costs`, payload, { headers }).subscribe({
      next: () => {
        this.modalService.showAlert('All ingredient prices have been saved successfully!', 'Success', 'success');
        this.loadIngredientCosts();
      },
      error: (err) => {
        console.error('Failed to save costs', err);
        this.modalService.showAlert('Failed to save prices. Please try again.', 'Error', 'error');
      }
    });
  }
}
