import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { CommonModule, PercentPipe, TitleCasePipe, DecimalPipe, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CalculatedRecipe } from '../../logic/bakers-math';
import type { ProductNutritionDisplay } from '../storefront/storefront';

@Component({
  selector: 'app-product-details-modal',
  standalone: true,
  imports: [CommonModule, PercentPipe, TitleCasePipe, DecimalPipe, NgOptimizedImage, FormsModule],
  template: `
    <div class="product-details-modal-overlay" (click)="close.emit()" role="dialog" aria-modal="true" aria-labelledby="product-details-title">
      <div class="product-details-modal card" (click)="$event.stopPropagation()">
        <button class="btn-close-modal" (click)="close.emit()" aria-label="Close details">×</button>

        <div class="details-image-wrap">
          @if (product.images && product.images.length > 0) {
            @if (isInlineImage(product.images[0])) {
              <img [src]="product.images[0]" [alt]="product.name" class="details-image" width="960" height="540">
            } @else {
              <img [ngSrc]="product.images[0]" [alt]="product.name" class="details-image" width="960" height="540" sizes="(max-width: 768px) 92vw, 50vw">
            }
          } @else if (product.imageUrl) {
            @if (isInlineImage(product.imageUrl)) {
              <img [src]="product.imageUrl" [alt]="product.name" class="details-image" width="960" height="540">
            } @else {
              <img [ngSrc]="product.imageUrl" [alt]="product.name" class="details-image" width="960" height="540" sizes="(max-width: 768px) 92vw, 50vw">
            }
          } @else {
            <div class="details-image-placeholder" aria-hidden="true">🍞</div>
          }
        </div>

        <h2 id="product-details-title">{{ product.name }}</h2>
        <p class="details-subtitle">{{product.category === 'SPECIAL' ? 'Limited Release' : (product.category | titlecase)}} @if (product.flavorProfile) { • {{product.flavorProfile | titlecase}} }</p>
        <p class="details-description">{{ product.description || 'Handcrafted with long fermentation and premium ingredients.' }}</p>

        @if (nutrition; as n) {
          <section class="details-section nutrition">
            <h3>Nutrition Facts</h3>
            @if (n.hasData) {
              @if (n.itemWeightGrams) {
                <p class="item-weight-note">Each {{ product.name }} weighs about <strong>{{ n.itemWeightGrams }}g</strong>.</p>
              }
              <p class="nutrition-label">{{n.label}}</p>
              <div class="nutrition-grid">
                <div><span>Calories</span><strong>{{n.calories | number:'1.0-0'}}</strong></div>
                <div><span>Protein</span><strong>{{n.protein | number:'1.0-1'}}g</strong></div>
                <div><span>Carbs</span><strong>{{n.carbs | number:'1.0-1'}}g</strong></div>
                <div><span>Fat</span><strong>{{n.fat | number:'1.0-1'}}g</strong></div>
              </div>

              <div class="grams-calculator">
                <button type="button" class="grams-calculator-toggle" (click)="showGramsCalculator.set(!showGramsCalculator())">
                  🍽️ Calculate for the amount you'll eat
                </button>
                @if (showGramsCalculator()) {
                  <div class="grams-calculator-body">
                    <label for="grams-eaten">Grams eaten</label>
                    <div class="grams-input-row">
                      <input
                        id="grams-eaten"
                        type="range"
                        min="1"
                        [max]="sliderMax()"
                        step="1"
                        [ngModel]="gramsEaten()"
                        (ngModelChange)="gramsEaten.set(+$event)"
                      >
                      <input
                        type="number"
                        min="0"
                        class="grams-number"
                        [ngModel]="gramsEaten()"
                        (ngModelChange)="gramsEaten.set(+$event)"
                        aria-label="Grams eaten (number)"
                      >
                      <span>g</span>
                    </div>
                    <p class="grams-hint">
                      @if (n.itemWeightGrams) {
                        A whole {{ product.name }} is about {{ n.itemWeightGrams }}g; a slice is usually 40–60g.
                      } @else {
                        A slice is usually 40–60g.
                      }
                    </p>
                    <div class="nutrition-grid grams-result">
                      <div><span>Calories</span><strong>{{n.perGram.calories * gramsEaten() | number:'1.0-0'}}</strong></div>
                      <div><span>Protein</span><strong>{{n.perGram.protein * gramsEaten() | number:'1.0-1'}}g</strong></div>
                      <div><span>Carbs</span><strong>{{n.perGram.carbs * gramsEaten() | number:'1.0-1'}}g</strong></div>
                      <div><span>Fat</span><strong>{{n.perGram.fat * gramsEaten() | number:'1.0-1'}}g</strong></div>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <p class="nutrition-missing">Nutrition details are not available for this item yet.</p>
            }
          </section>
        }

        <section class="details-section">
          <h3>More Info</h3>
          <ul class="details-list">
            <li>Hydration: <strong>{{product.trueHydration | percent:'1.0-0'}}</strong></li>
            @if (product.itemWeightGrams) {
              <li>Weight: <strong>~{{product.itemWeightGrams}}g each</strong></li>
            }
            <li>Serving size: <strong>{{product.servingSizeGrams || 50}}g</strong></li>
            @if (product.prepTimeMinutes) {
              <li>Prep time: <strong>{{product.prepTimeMinutes}} min</strong></li>
            }
            @if (product.bakeTimeMinutes) {
              <li>Bake time: <strong>{{product.bakeTimeMinutes}} min</strong></li>
            }
          </ul>
        </section>

        @if (product.ingredients && product.ingredients.length > 0) {
          <section class="details-section">
            <h3>Ingredients</h3>
            <p class="ingredient-list">
              @for (ingredient of product.ingredients; track ingredient.name; let idx = $index) {
                {{ingredient.name}}@if (idx < product.ingredients.length - 1) {, }
              }
            </p>
          </section>
        }

        <div class="details-actions">
          <button class="btn-primary" (click)="addToBag.emit(product)">Add to Bag</button>
          <button class="btn-outline" (click)="close.emit()">Close</button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./product-details-modal.css']
})
export class ProductDetailsModalComponent implements OnChanges {
  @Input({ required: true }) product!: CalculatedRecipe;
  @Input() nutrition: ProductNutritionDisplay | null = null;
  @Output() close = new EventEmitter<void>();
  @Output() addToBag = new EventEmitter<CalculatedRecipe>();

  showGramsCalculator = signal(false);
  gramsEaten = signal(50);
  sliderMax = signal(500);

  ngOnChanges(changes: SimpleChanges): void {
    // Default the grams input to a whole item (or a serving) only when a
    // different product is selected — not on every re-render.
    const productChange = changes['product'];
    const isNewProduct = !productChange || productChange.firstChange
      || productChange.previousValue?.id !== productChange.currentValue?.id;
    if (!isNewProduct) return;

    const itemWeight = this.nutrition?.itemWeightGrams || this.product?.itemWeightGrams;
    const defaultGrams = itemWeight || this.nutrition?.servingSizeGrams || this.product?.servingSizeGrams || 50;
    this.gramsEaten.set(defaultGrams);
    this.sliderMax.set(Math.max(500, Math.ceil(defaultGrams * 1.5)));
  }

  isInlineImage(url: string): boolean {
    return url.startsWith('data:') || url.startsWith('blob:');
  }
}
