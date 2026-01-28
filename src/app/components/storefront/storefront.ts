import { Component, OnInit, signal, inject, computed, effect } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe, DatePipe, PercentPipe } from '@angular/common';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, RecipeCategory, FlavorProfile, Review } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';
import { ModalService } from '../../services/modal.service';
import { Router } from '@angular/router';
import { ReviewModalComponent } from '../review-modal/review-modal';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, DatePipe, PercentPipe, FormsModule, ReviewModalComponent],
  templateUrl: './storefront.html',
  styleUrls: ['./storefront.css']
})
export class StorefrontComponent implements OnInit {
  private cartService = inject(CartService);
  protected authService = inject(AuthService);
  protected reviewService = inject(ReviewService);
  private router = inject(Router);
  private http = inject(HttpClient);

  products = signal<CalculatedRecipe[]>([]);
  categories = signal<RecipeCategory[]>(['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'SPECIAL', 'OTHER']);
  selectedCategory = signal<RecipeCategory | 'ALL'>('ALL');
  selectedFlavor = signal<FlavorProfile | 'ALL'>('ALL');

  selectedProductForReview = signal<CalculatedRecipe | null>(null);
  showReviewsForProduct = signal<string | null>(null);
  showSubscriptionInfo = signal(false);
  searchTerm = signal('');

  replyingToReviewId = signal<string | null>(null);
  replyText = signal<string>('');

  editingReviewId = signal<string | null>(null);
  editReviewText = signal<string>('');
  editReviewRating = signal<number>(5);

  productToDelete = signal<CalculatedRecipe | null>(null);

  filteredProducts = computed(() => {
    const category = this.selectedCategory();
    const flavor = this.selectedFlavor();
    const search = this.searchTerm().toLowerCase();
    const isBaker = this.authService.isBaker();

    return this.products().filter(p => {
      // If baker, show everything. If customer, only show if not hidden.
      if (!isBaker && p.isHidden) return false;

      const matchCategory = category === 'ALL' || p.category === category;
      const matchFlavor = flavor === 'ALL' || (p.flavorProfile && p.flavorProfile.toUpperCase() === flavor.toUpperCase());
      const matchSearch = p.name.toLowerCase().includes(search) ||
                          p.description?.toLowerCase().includes(search);
      return matchCategory && matchFlavor && matchSearch;
    });
  });

  topRatedByCategory = computed(() => {
    const products = this.products();
    const categories: RecipeCategory[] = ['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'SPECIAL', 'OTHER'];
    const topRated: Record<string, string> = {};

    categories.forEach(cat => {
      const catProducts = products.filter(p => p.category === cat);
      if (catProducts.length > 0) {
        const top = catProducts.reduce((prev, current) => {
          const prevRating = this.reviewService.getAverageRating(prev.id || '')();
          const currRating = this.reviewService.getAverageRating(current.id || '')();

          if (prevRating > currRating) return prev;
          if (currRating > prevRating) return current;

          // If ratings are equal, pick the one with more reviews
          const prevCount = this.getReviews(prev.id || '').length;
          const currCount = this.getReviews(current.id || '').length;
          return prevCount >= currCount ? prev : current;
        });

        const topRating = this.reviewService.getAverageRating(top.id || '')();
        // For Experimental category, we show the badge if it has any rating
        // For others, maybe we only want 4+? The existing logic was > 0.
        if (top.id && topRating > 0) {
          topRated[cat] = top.id;
        }
      }
    });

    return topRated;
  });

  isTopRated(product: CalculatedRecipe): boolean {
    const topId = this.topRatedByCategory()[product.category];
    return topId === product.id;
  }

  setCategory(category: RecipeCategory | 'ALL') {
    this.selectedCategory.set(category);
    // Reset flavor if not bread
    if (category !== 'BREAD' && category !== 'ALL') {
      this.selectedFlavor.set('ALL');
    }
  }

  setFlavor(flavor: FlavorProfile | 'ALL') {
    this.selectedFlavor.set(flavor);
  }

  constructor() {
    // React to tenant changes to reload recipes
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        console.log('[Storefront] Tenant identified, loading recipes:', tenant.slug);
        this.loadRecipes();
      }
    });
  }

  ngOnInit(): void {
  }

  private tenantService = inject(TenantService);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  private getOptimizedRecipesForStorage(recipes: CalculatedRecipe[]): CalculatedRecipe[] {
    return recipes.map(r => ({
      ...r,
      imageUrl: r.imageUrl?.startsWith('data:') ? '' : r.imageUrl,
      images: r.images?.map(img => img.startsWith('data:') ? '' : img).filter(img => img !== '')
    }));
  }

  loadRecipes(): void {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) {
      console.warn('[Storefront] Skipping loadRecipes: No tenant slug identified yet.');
      return;
    }
    const headers = new HttpHeaders().set('x-tenant-slug', slug);
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes: CalculatedRecipe[]) => {
        this.products.set(recipes);
        // Sync local storage just in case other parts of the app still rely on it
        try {
          localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(recipes)));
        } catch (e) {
          console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
        }

        // Fetch reviews for each recipe to ensure ratings are up to date
        recipes.forEach(r => {
          if (r.id) this.reviewService.fetchReviewsForRecipe(r.id);
        });
      },
      error: (err: any) => {
        console.error('Failed to load recipes from database:', err);
        // Fallback to local storage if DB fails
        const saved = localStorage.getItem('bakery_recipes');
        if (saved) {
          this.products.set(JSON.parse(saved));
        }
      }
    });
  }

  deleteReview(reviewId: string): void {
    if (confirm('Are you sure you want to delete this review?')) {
      this.reviewService.deleteReview(reviewId);
    }
  }

  startReply(review: Review): void {
    this.replyingToReviewId.set(review.id);
    this.replyText.set(review.reply || '');
  }

  submitReply(reviewId: string): void {
    if (!this.replyText().trim()) return;
    this.reviewService.replyToReview(reviewId, this.replyText());
    this.cancelReply();
  }

  cancelReply(): void {
    this.replyingToReviewId.set(null);
    this.replyText.set('');
  }

  startEditReview(review: Review): void {
    this.editingReviewId.set(review.id);
    this.editReviewText.set(review.comment);
    this.editReviewRating.set(review.rating);
  }

  submitEditReview(reviewId: string): void {
    if (!this.editReviewText().trim()) return;
    this.reviewService.updateReview(reviewId, this.editReviewRating(), this.editReviewText());
    this.cancelEditReview();
  }

  cancelEditReview(): void {
    this.editingReviewId.set(null);
    this.editReviewText.set('');
    this.editReviewRating.set(5);
  }

  private modalService = inject(ModalService);

  addToCart(product: CalculatedRecipe): void {
    this.modalService.showCustomization(product);
  }

  subscribe(product: CalculatedRecipe): void {
    // Add to cart with subscription pre-toggled
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

    this.http.delete(`${environment.apiUrl}/orders/recipes/${product.id}`).subscribe({
      next: () => {
        console.log('Product deleted from cloud:', product.id);
        const updated = this.products().filter(p => p.id !== product.id);
        this.products.set(updated);
        try {
          localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(updated)));
        } catch (e) {
          console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
        }
        this.cancelDelete();
      },
      error: (err) => {
        console.error('Failed to delete product from cloud:', err);
        // Fallback to local delete
        const updated = this.products().filter(p => p.id !== product.id);
        this.products.set(updated);
        try {
          localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(updated)));
        } catch (e) {
          console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
        }
        this.cancelDelete();
      }
    });
  }

  deleteProduct(product: CalculatedRecipe): void {
    this.confirmDeleteProduct(product);
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
}
