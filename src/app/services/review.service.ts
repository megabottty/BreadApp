import { Injectable, signal, computed, inject } from '@angular/core';
import { Review, Recipe } from '../logic/bakers-math';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TenantService } from './tenant.service';

@Injectable({
  providedIn: 'root'
})
export class ReviewService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);
  private apiUrl = 'http://localhost:3000/api/orders';
  private allReviews = signal<Review[]>([]);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

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
    this.http.get<any[]>(`${this.apiUrl}/recipes/${recipeId}/reviews`, { headers: this.headers }).subscribe({
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
    this.http.post<any>(`${this.apiUrl}/reviews`, review, { headers: this.headers }).subscribe({
      next: (formatted: Review) => {
        this.allReviews.update(prev => [...prev, formatted]);
        try {
          localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
        } catch (e) {
          console.warn('Failed to save reviews to localStorage (quota exceeded)', e);
        }
        this.updateRecipeAverage(formatted.recipeId);
      },
      error: (err) => {
        console.error('Failed to save review to DB, saving locally', err);
        this.allReviews.update(prev => [...prev, review]);
        try {
          localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
        } catch (e) {
          console.warn('Failed to save reviews to localStorage (quota exceeded)', e);
        }
        this.updateRecipeAverage(review.recipeId);
      }
    });
  }

  deleteReview(reviewId: string) {
    return this.http.delete(`${this.apiUrl}/reviews/${reviewId}`, { headers: this.headers }).subscribe({
      next: () => {
        const review = this.allReviews().find(r => r.id === reviewId);
        this.allReviews.update(prev => prev.filter(r => r.id !== reviewId));
        localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
        if (review) {
          this.updateRecipeAverage(review.recipeId);
        }
      },
      error: (err) => console.error('Failed to delete review', err)
    });
  }

  replyToReview(reviewId: string, reply: string) {
    return this.http.patch<any>(`${this.apiUrl}/reviews/${reviewId}/reply`, { reply }, { headers: this.headers }).subscribe({
      next: (updated) => {
        this.allReviews.update(prev => prev.map(r =>
          r.id === reviewId ? { ...r, reply: updated.reply } : r
        ));
        localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
      },
      error: (err) => console.error('Failed to reply to review', err)
    });
  }

  updateReview(reviewId: string, rating: number, comment: string) {
    return this.http.patch<any>(`${this.apiUrl}/reviews/${reviewId}`, { rating, comment }, { headers: this.headers }).subscribe({
      next: (updated) => {
        this.allReviews.update(prev => prev.map(r =>
          r.id === reviewId ? { ...r, rating: updated.rating, comment: updated.comment } : r
        ));
        localStorage.setItem('bakery_reviews', JSON.stringify(this.allReviews()));
        const review = this.allReviews().find(r => r.id === reviewId);
        if (review) {
          this.updateRecipeAverage(review.recipeId);
        }
      },
      error: (err) => console.error('Failed to update review', err)
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

          // Optimization: Ensure images are not re-saved to localStorage if they were somehow present
          const optimizedRecipes = recipes.map(r => ({
            ...r,
            imageUrl: r.imageUrl?.startsWith('data:') ? '' : r.imageUrl,
            images: r.images?.map(img => img.startsWith('data:') ? '' : img).filter(img => img !== '')
          }));

          try {
            localStorage.setItem('bakery_recipes', JSON.stringify(optimizedRecipes));
          } catch (e) {
            console.warn('Failed to update recipes in localStorage (quota exceeded)', e);
          }
        }
      } catch (e) {
        console.error('Error updating recipe average', e);
      }
    }
  }
}
