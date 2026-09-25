import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IngredientType } from '../../logic/bakers-math';
import { MEASURE_UNITS, MeasureUnit, UnitDefinition } from '../../logic/units';
import { ModalService } from '../../services/modal.service';
import { PantryItem, PantryService } from '../../services/pantry.service';
import { RecipeService } from '../../services/recipe.service';
import { TenantService } from '../../services/tenant.service';

type PantryFilter = 'all' | 'needs-price';

/**
 * "My Pantry" — the baker's reusable ingredient catalog: package price,
 * weight, unit, density, and nutrition, once per ingredient, shared across
 * every recipe. Recipe rows pull from this (and can fix a price inline via
 * the price chip); this screen is where the pantry itself is reviewed,
 * corrected, or cleaned up.
 */
@Component({
  selector: 'app-ingredient-manager',
  imports: [FormsModule, CurrencyPipe],
  templateUrl: './ingredient-manager.html',
  styleUrl: './ingredient-manager.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IngredientManagerComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly tenantService = inject(TenantService);
  private readonly modalService = inject(ModalService);
  private readonly recipeService = inject(RecipeService);
  protected readonly pantryService = inject(PantryService);

  protected readonly measureUnits: readonly UnitDefinition[] = MEASURE_UNITS;
  protected readonly ingredientTypes: IngredientType[] = ['FLOUR', 'WATER', 'LEVAIN', 'SALT', 'INCLUSION'];

  protected readonly searchTerm = signal('');
  protected readonly filter = signal<PantryFilter>('all');
  /** Names with a save currently in flight or just confirmed -- drives the
   * "Saving…" / "Saved ✓" text next to each card. */
  protected readonly savingNames = signal<ReadonlySet<string>>(new Set());
  protected readonly justSavedNames = signal<ReadonlySet<string>>(new Set());
  protected readonly itemPendingArchive = signal<PantryItem | null>(null);
  protected readonly newItemName = signal('');

  /** How many saved recipes currently use each ingredient, by normalized
   * name -- gives an otherwise-inert pantry row a reason to matter. */
  protected readonly usageCounts = computed<ReadonlyMap<string, number>>(() => {
    const counts = new Map<string, number>();
    for (const recipe of this.recipeService.savedRecipes()) {
      for (const ing of recipe.ingredients || []) {
        const key = (ing.name || '').trim().toLowerCase();
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return counts;
  });

  protected readonly visibleItems = computed<readonly PantryItem[]>(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const activeFilter = this.filter();
    return this.pantryService.items()
      .filter(item => !item.isArchived)
      .filter(item => activeFilter !== 'needs-price' || item.costBasis === 'MISSING')
      .filter(item => !term || item.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  ngOnInit(): void {
    this.pantryService.load();

    // Support the results-panel "Add prices" deep link: /ingredients?filter=needs-price
    const requestedFilter = this.route.snapshot.queryParamMap.get('filter');
    if (requestedFilter === 'needs-price') {
      this.filter.set('needs-price');
    }
  }

  protected usageCountFor(item: PantryItem): number {
    return this.usageCounts().get(item.normalizedName) || 0;
  }

  private get tenantReady(): boolean {
    return !!this.tenantService.tenant();
  }

  /** Saves one field immediately on blur -- no debounce, no "Save All"
   * button. That "Save All" button on the old screen is exactly why a price
   * she'd entered could silently go unsaved; saving per field per row
   * removes the chance to lose it. */
  protected commitField(item: PantryItem, patch: Partial<PantryItem>): void {
    if (!this.tenantReady) return;

    this.savingNames.update(prev => new Set(prev).add(item.normalizedName));
    this.pantryService.save({
      name: item.name,
      bulkPrice: patch.bulkPrice ?? item.bulkPrice,
      bulkWeight: patch.bulkWeight ?? item.bulkWeight,
      packSize: patch.packSize ?? item.packSize,
      packUnit: patch.packUnit ?? item.packUnit,
      gramsPerCup: patch.gramsPerCup ?? item.gramsPerCup,
      gramsPerItem: patch.gramsPerItem ?? item.gramsPerItem,
      defaultType: patch.defaultType ?? item.defaultType
    }).subscribe({
      next: () => this.flagSaved(item.normalizedName),
      error: () => {
        this.savingNames.update(prev => {
          const next = new Set(prev);
          next.delete(item.normalizedName);
          return next;
        });
        this.modalService.showAlert('Failed to save. Please try again.', 'Error', 'error');
      }
    });
  }

  private flagSaved(normalizedName: string): void {
    this.savingNames.update(prev => {
      const next = new Set(prev);
      next.delete(normalizedName);
      return next;
    });
    this.justSavedNames.update(prev => new Set(prev).add(normalizedName));
    setTimeout(() => {
      this.justSavedNames.update(prev => {
        const next = new Set(prev);
        next.delete(normalizedName);
        return next;
      });
    }, 2000);
  }

  /** Package size + unit are entered together; a size with no unit yet
   * (unit defaults to 'g') just means the grams figure is the size itself. */
  protected onPackSizeChange(item: PantryItem, rawValue: string): void {
    const size = Number(rawValue);
    if (!Number.isFinite(size) || size < 0) return;
    this.commitField(item, { packSize: size, bulkWeight: this.resolvePackGrams(size, item.packUnit, item) });
  }

  protected onPackUnitChange(item: PantryItem, unit: MeasureUnit): void {
    this.commitField(item, { packUnit: unit, bulkWeight: this.resolvePackGrams(item.packSize ?? 0, unit, item) });
  }

  protected onPackPriceChange(item: PantryItem, rawValue: string): void {
    const price = Number(rawValue);
    if (!Number.isFinite(price) || price < 0) return;
    this.commitField(item, { bulkPrice: price });
  }

  protected onDensityChange(item: PantryItem, rawValue: string): void {
    const grams = Number(rawValue);
    if (!Number.isFinite(grams) || grams < 0) return;
    this.commitField(item, { gramsPerCup: grams });
  }

  protected onPerItemWeightChange(item: PantryItem, rawValue: string): void {
    const grams = Number(rawValue);
    if (!Number.isFinite(grams) || grams < 0) return;
    this.commitField(item, { gramsPerItem: grams });
  }

  protected onTypeChange(item: PantryItem, type: IngredientType): void {
    this.commitField(item, { defaultType: type });
  }

  private resolvePackGrams(size: number, unit: MeasureUnit, item: PantryItem): number {
    // Mass units convert exactly; volume/count need this item's own density,
    // which the pantry already has if she's set one.
    const massFactors: Record<string, number> = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
    if (unit in massFactors) return size * massFactors[unit];
    if (unit === 'cup' && item.gramsPerCup) return size * item.gramsPerCup;
    if (unit === 'each' && item.gramsPerItem) return size * item.gramsPerItem;
    return item.bulkWeight ?? 0; // unresolvable without a density -- leave grams as-is rather than guess
  }

  protected addNewItem(): void {
    if (!this.tenantReady) return;
    const name = this.newItemName().trim();
    if (!name) return;

    if (this.pantryService.find(name)) {
      this.modalService.showAlert(`"${name}" is already in your pantry.`, 'Already in your pantry', 'info');
      return;
    }

    this.pantryService.save({ name }).subscribe({
      error: () => this.modalService.showAlert('Failed to add ingredient. Please try again.', 'Error', 'error')
    });
    this.newItemName.set('');
  }

  protected confirmArchive(item: PantryItem): void {
    this.itemPendingArchive.set(item);
  }

  protected cancelArchive(): void {
    this.itemPendingArchive.set(null);
  }

  protected executeArchive(): void {
    const item = this.itemPendingArchive();
    if (!item) return;
    this.pantryService.archive(item.id).subscribe({
      error: () => this.modalService.showAlert('Failed to remove ingredient. Please try again.', 'Error', 'error')
    });
    this.itemPendingArchive.set(null);
  }
}
