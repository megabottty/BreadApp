import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, PercentPipe, TitleCasePipe, DecimalPipe, NgOptimizedImage } from '@angular/common';
import { CalculatedRecipe } from '../../logic/bakers-math';

@Component({
  selector: 'app-product-details-modal',
  standalone: true,
  imports: [CommonModule, PercentPipe, TitleCasePipe, DecimalPipe, NgOptimizedImage],
  template: `
    <div class="product-details-modal-overlay" (click)="close.emit()" role="dialog" aria-modal="true" aria-labelledby="product-details-title">
      <div class="product-details-modal card" (click)="$event.stopPropagation()">
        <button class="btn-close-modal" (click)="close.emit()" aria-label="Close details">×</button>

        <div class="details-image-wrap">
          @if (product.images && product.images.length > 0) {
            @if (isInlineImage(product.images[0])) {
              <img [src]="product.images[0]" [alt]="product.name" class="details-image" width="960" height="540">
            } @else {
              <img [ngSrc]="product.images[0]" [alt]="product.name" class="details-image" width="960" height="540" sizes="(max-width: 768px) 92vw, 680px">
            }
          } @else if (product.imageUrl) {
            @if (isInlineImage(product.imageUrl)) {
              <img [src]="product.imageUrl" [alt]="product.name" class="details-image" width="960" height="540">
            } @else {
              <img [ngSrc]="product.imageUrl" [alt]="product.name" class="details-image" width="960" height="540" sizes="(max-width: 768px) 92vw, 680px">
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
              <p class="nutrition-label">{{n.label}}</p>
              <div class="nutrition-grid">
                <div><span>Calories</span><strong>{{n.calories | number:'1.0-0'}}</strong></div>
                <div><span>Protein</span><strong>{{n.protein | number:'1.0-1'}}g</strong></div>
                <div><span>Carbs</span><strong>{{n.carbs | number:'1.0-1'}}g</strong></div>
                <div><span>Fat</span><strong>{{n.fat | number:'1.0-1'}}g</strong></div>
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
export class ProductDetailsModalComponent {
  @Input({ required: true }) product!: CalculatedRecipe;
  @Input() nutrition: any;
  @Output() close = new EventEmitter<void>();
  @Output() addToBag = new EventEmitter<CalculatedRecipe>();

  isInlineImage(url: string): boolean {
    return url.startsWith('data:') || url.startsWith('blob:');
  }
}
