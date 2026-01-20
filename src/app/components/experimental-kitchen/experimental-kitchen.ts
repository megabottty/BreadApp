import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe, PercentPipe, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CalculatedRecipe, Review } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';
import { Router } from '@angular/router';
import { ReviewModalComponent } from '../review-modal/review-modal';

@Component({
  selector: 'app-experimental-kitchen',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, PercentPipe, DatePipe, ReviewModalComponent],
  templateUrl: './experimental-kitchen.html',
  styleUrls: ['./experimental-kitchen.css']
})
export class ExperimentalKitchenComponent implements OnInit {
  private cartService = inject(CartService);
  protected authService = inject(AuthService);
  protected reviewService = inject(ReviewService);
  private router = inject(Router);
  private http = inject(HttpClient);

  products = signal<CalculatedRecipe[]>([]);

  selectedProductForReview = signal<CalculatedRecipe | null>(null);
  showReviewsForProduct = signal<string | null>(null);

  productToDelete = signal<CalculatedRecipe | null>(null);

  experimentalProducts = computed(() => {
    return this.products().filter(p => p.category === 'SPECIAL');
  });

  topRatedSpecialId = computed(() => {
    const specials = this.experimentalProducts();
    if (specials.length === 0) return null;

    const top = specials.reduce((prev, current) => {
      const prevRating = this.reviewService.getAverageRating(prev.id || '')();
      const currRating = this.reviewService.getAverageRating(current.id || '')();

      if (prevRating > currRating) return prev;
      if (currRating > prevRating) return current;

      const prevCount = this.getReviews(prev.id || '').length;
      const currCount = this.getReviews(current.id || '').length;
      return prevCount >= currCount ? prev : current;
    });

    const topRating = this.reviewService.getAverageRating(top.id || '')();
    return (top.id && topRating > 0) ? top.id : null;
  });

  isTopRated(product: CalculatedRecipe): boolean {
    return this.topRatedSpecialId() === product.id;
  }

  ngOnInit(): void {
    this.loadRecipes();
  }

  loadRecipes(): void {
    this.http.get<CalculatedRecipe[]>('http://localhost:3000/api/orders/recipes').subscribe({
      next: (recipes: CalculatedRecipe[]) => {
        this.products.set(recipes);
        localStorage.setItem('bakery_recipes', JSON.stringify(recipes));

        // Fetch reviews for experimental recipes
        recipes.filter(p => p.category === 'SPECIAL').forEach(r => {
          if (r.id) this.reviewService.fetchReviewsForRecipe(r.id);
        });
      },
      error: (err: any) => {
        console.error('Failed to load experimental recipes:', err);
        const saved = localStorage.getItem('bakery_recipes');
        if (saved) {
          this.products.set(JSON.parse(saved));
        }
      }
    });
  }

  openReviewModal(product: CalculatedRecipe) {
    this.selectedProductForReview.set(product);
  }

  toggleReviews(productId: string) {
    if (this.showReviewsForProduct() === productId) {
      this.showReviewsForProduct.set(null);
    } else {
      this.showReviewsForProduct.set(productId);
    }
  }

  getReviews(productId: string): Review[] {
    return this.reviewService.getReviewsForRecipe(productId)();
  }

  addToCart(product: CalculatedRecipe): void {
    this.cartService.addToCart(product);
  }

  subscribe(product: CalculatedRecipe): void {
    this.cartService.addToCart(product);
    this.cartService.toggleSubscription(product.id || '');
    this.router.navigate(['/cart']);
  }

  editProduct(product: CalculatedRecipe): void {
    this.router.navigate(['/calculator', product.id]);
  }

  confirmDeleteProduct(product: CalculatedRecipe): void {
    this.productToDelete.set(product);
  }

  cancelDelete(): void {
    this.productToDelete.set(null);
  }

  executeDelete(): void {
    const product = this.productToDelete();
    if (!product || !product.id) return;

    this.http.delete(`http://localhost:3000/api/orders/recipes/${product.id}`).subscribe({
      next: () => {
        const updated = this.products().filter(p => p.id !== product.id);
        this.products.set(updated);
        localStorage.setItem('bakery_recipes', JSON.stringify(updated));
        this.cancelDelete();
      },
      error: (err) => {
        console.error('Failed to delete experiment:', err);
        const updated = this.products().filter(p => p.id !== product.id);
        this.products.set(updated);
        localStorage.setItem('bakery_recipes', JSON.stringify(updated));
        this.cancelDelete();
      }
    });
  }

  deleteProduct(product: CalculatedRecipe): void {
    this.confirmDeleteProduct(product);
  }
}
