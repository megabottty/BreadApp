import { Injectable, signal, computed, inject } from '@angular/core';
import { Review, Recipe } from '../logic/bakers-math';

@Injectable({
  providedIn: 'root'
})
export class ReviewService {
  private allReviews = signal<Review[]>([]);

  constructor() {
    this.loadReviews();
  }

  private loadReviews() {
    const saved = localStorage.getItem('bakery_reviews');
    if (saved) {
      try {
        this.allReviews.set(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading reviews', e);
      }
    }
  }

  private saveReviews() {
    localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
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
    this.allReviews.update(prev => [...prev, review]);
    this.saveReviews();
    this.updateRecipeAverage(review.recipeId);
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
