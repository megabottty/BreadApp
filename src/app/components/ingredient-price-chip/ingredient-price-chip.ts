import { Component, ChangeDetectionStrategy, computed, input, output, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IngredientType, resolveIngredientCostPerGram } from '../../logic/bakers-math';

/**
 * Collapses an ingredient row's "Package Price" and "Package Weight" fields
 * into a single cost chip + popover. Those two fields describe the bag in
 * the baker's cupboard, not this recipe, so they no longer sit in every row
 * of every recipe — they live behind one click, and the row shows only what
 * this ingredient actually costs here.
 *
 * Presentational only: the recipe form's `bulkPrice`/`bulkWeight` FormControls
 * remain the single source of truth. This component edits a local draft and
 * emits on close/blur rather than patching the parent form on every keystroke.
 */
@Component({
  selector: 'app-ingredient-price-chip',
  imports: [FormsModule, CurrencyPipe],
  templateUrl: './ingredient-price-chip.html',
  styleUrl: './ingredient-price-chip.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IngredientPriceChipComponent {
  readonly ingredientName = input.required<string>();
  readonly ingredientType = input.required<IngredientType>();
  /** How much of this ingredient the recipe uses, in grams — drives the
   * "$1.20 of flour in this recipe" figure shown in the popover. */
  readonly amountGrams = input<number>(0);
  readonly bulkPrice = input<number | null>(null);
  readonly bulkWeightGrams = input<number | null>(null);
  /** The pantry's current price for this ingredient, if it differs from
   * what's in this recipe row — surfaced as an offer to sync, never applied
   * automatically. Fixes a real bug: this used to get silently patched into
   * the row on blur/select, clobbering a price she'd just typed. */
  readonly pantryBulkPrice = input<number | null>(null);
  readonly pantryBulkWeightGrams = input<number | null>(null);

  readonly bulkPriceChange = output<number | null>();
  readonly bulkWeightGramsChange = output<number | null>();

  protected readonly isOpen = signal(false);

  // Local edit buffers so typing in the popover doesn't push a value into the
  // parent form (and trigger its unsaved-changes/draft-save logic) on every
  // keystroke — only when the popover closes.
  protected readonly draftPrice = signal<number | null>(null);
  protected readonly draftWeight = signal<number | null>(null);

  protected readonly resolved = computed(() => resolveIngredientCostPerGram({
    name: this.ingredientName(),
    weight: this.amountGrams(),
    type: this.ingredientType(),
    bulkPrice: this.bulkPrice() ?? undefined,
    bulkWeight: this.bulkWeightGrams() ?? undefined
  }));

  protected readonly costPerGram = computed(() => this.resolved().costPerGram);
  protected readonly costBasis = computed(() => this.resolved().costBasis);
  protected readonly costHere = computed(() => this.costPerGram() * this.amountGrams());

  protected readonly draftResolved = computed(() => resolveIngredientCostPerGram({
    name: this.ingredientName(),
    weight: this.amountGrams(),
    type: this.ingredientType(),
    bulkPrice: this.draftPrice() ?? undefined,
    bulkWeight: this.draftWeight() ?? undefined
  }));
  protected readonly draftCostPerGram = computed(() => this.draftResolved().costPerGram);
  protected readonly draftCostHere = computed(() => this.draftCostPerGram() * this.amountGrams());

  protected readonly hasPantryMismatch = computed(() => {
    const pantryPrice = this.pantryBulkPrice();
    const pantryWeight = this.pantryBulkWeightGrams();
    if (pantryPrice == null || pantryWeight == null) return false;
    return pantryPrice !== this.draftPrice() || pantryWeight !== this.draftWeight();
  });

  protected useDraftFromPantry(): void {
    this.draftPrice.set(this.pantryBulkPrice());
    this.draftWeight.set(this.pantryBulkWeightGrams());
  }

  protected open(): void {
    this.draftPrice.set(this.bulkPrice());
    this.draftWeight.set(this.bulkWeightGrams());
    this.isOpen.set(true);
  }

  protected close(): void {
    this.commit();
    this.isOpen.set(false);
  }

  private commit(): void {
    if (this.draftPrice() !== this.bulkPrice()) {
      this.bulkPriceChange.emit(this.draftPrice());
    }
    if (this.draftWeight() !== this.bulkWeightGrams()) {
      this.bulkWeightGramsChange.emit(this.draftWeight());
    }
  }
}
