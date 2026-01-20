import { Injectable, signal, computed, inject } from '@angular/core';
import { Review, Recipe } from '../logic/bakers-math';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class ReviewService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/orders';
  private allReviews = signal<Review[]>([]);

  constructor() {
    this.loadReviewsFromLocalStorage();
  }

  private loadReviewsFromLocalStorage() {
    const saved = localStorage.getItem('bakery_reviews');
    if (saved) {
      try {
        this.allReviews.set(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading reviews from localStorage', e);
      }
    }
  }

  fetchReviewsForRecipe(recipeId: string) {
    if (!recipeId) return;
    console.log(`[ReviewService] Fetching reviews for recipe: ${recipeId}`);
    this.http.get<any[]>(`${this.apiUrl}/recipes/${recipeId}/reviews`).subscribe({
      next: (reviews) => {
        console.log(`[ReviewService] Received ${reviews.length} reviews for recipe: ${recipeId}`);
        this.allReviews.update(prev => {
          // Filter out existing reviews for this recipe to avoid duplicates
          const otherReviews = prev.filter(p => p.recipeId !== recipeId);
          // Ensure reviews have a date
          const validatedReviews = reviews.map(r => ({
            ...r,
            date: r.date || new Date().toISOString()
          }));
          return [...otherReviews, ...validatedReviews];
        });

        // Also update localStorage for persistence consistency
        localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
      },
      error: (err) => console.error(`[ReviewService] Error fetching reviews for ${recipeId}`, err)
    });
  }

  getReviewsForRecipe(recipeId: string) {
    return computed(() => this.allReviews().filter(r => r.recipeId === recipeId));
  }

  getAverageRating(recipeId: string) {
    return computed(() => {
      const reviews = this.allReviews().filter(r => r.recipeId === recipeId);
      if (reviews.length === 0) return 0;
      const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
      return sum / reviews.length;
    });
  }

  getUserReviewsCount(customerId: string) {
    return computed(() => this.allReviews().filter(r => r.customerId === customerId).length);
  }

  addReview(review: Review) {
    this.http.post<any>(`${this.apiUrl}/reviews`, review).subscribe({
      next: (formatted: Review) => {
        this.allReviews.update(prev => [...prev, formatted]);
        localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
        this.updateRecipeAverage(formatted.recipeId);
      },
      error: (err) => {
        console.error('Failed to save review to DB, saving locally', err);
        this.allReviews.update(prev => [...prev, review]);
        localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
        this.updateRecipeAverage(review.recipeId);
      }
    });
  }

  private updateRecipeAverage(recipeId: string) {
    const recipesStr = localStorage.getItem('bakery_recipes');
    if (recipesStr) {
      try {
        const recipes: Recipe[] = JSON.parse(recipesStr);
        const index = recipes.findIndex(r => r.id === recipeId);
        if (index !== -1) {
          const reviews = this.allReviews().filter(r => r.recipeId === recipeId);
          const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
          recipes[index].averageRating = reviews.length > 0 ? sum / reviews.length : 0;
          recipes[index].ratings = reviews; // Keep a few or all? For now all.
          localStorage.setItem('bakery_recipes', JSON.stringify(recipes));
        }
      } catch (e) {
        console.error('Error updating recipe average', e);
      }
    }
  }
}
