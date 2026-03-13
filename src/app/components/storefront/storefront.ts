import { Component, OnInit, signal, inject, computed, effect } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { ModalService } from '../../services/modal.service';
import { CommonModule, CurrencyPipe, TitleCasePipe, DatePipe, PercentPipe, NgOptimizedImage } from '@angular/common';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, RecipeCategory, FlavorProfile, Review } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';
import { Router, RouterLink } from '@angular/router';
import { ReviewModalComponent } from '../review-modal/review-modal';
import { TenantService } from '../../services/tenant.service';
import { AppLoadService } from '../../services/app-load.service';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, DatePipe, PercentPipe, FormsModule, NgOptimizedImage, ReviewModalComponent, RouterLink],
  templateUrl: './storefront.html',
  styleUrls: ['./storefront.css']
})
export class StorefrontComponent implements OnInit {
  private cartService = inject(CartService);
  protected authService = inject(AuthService);
  protected reviewService = inject(ReviewService);
  private router = inject(Router);
  private http = inject(HttpClient);
  private helpService = inject(HelpService);
  private modalService = inject(ModalService);

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

    return this.products().map(p => {
      let imageUrl = p.imageUrl;
      if (imageUrl && imageUrl.includes('unsplash.com')) {
        imageUrl += imageUrl.includes('?') ? '&fm=webp&w=800&q=75' : '?fm=webp&w=800&q=75';
      }
      return { ...p, imageUrl };
    }).filter(p => {
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
  private appLoadService = inject(AppLoadService);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  private getOptimizedRecipesForStorage(recipes: CalculatedRecipe[]) {
    return recipes.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      flavorProfile: r.flavorProfile,
      description: r.description,
      price: r.price,
      imageUrl: r.imageUrl,
      images: r.images,
      trueHydration: r.trueHydration,
      averageRating: r.averageRating,
      isHidden: r.isHidden,
      servingSizeGrams: r.servingSizeGrams,
      ingredients: r.ingredients?.map(ing => ({
        name: ing.name,
        weight: ing.weight,
        type: ing.type
      }))
    }));
  }

  private normalizeRecipeImages(recipes: CalculatedRecipe[]): CalculatedRecipe[] {
    return recipes.map(recipe => {
      if (recipe.images && recipe.images.length > 0) {
        return recipe;
      }

      if (recipe.imageUrl) {
        return {
          ...recipe,
          images: [recipe.imageUrl]
        };
      }

      return recipe;
    });
  }

  private scheduleOptimizedRecipeCache(recipes: CalculatedRecipe[]) {
    const persist = () => {
      try {
        localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(recipes)));
      } catch (e) {
        console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
      }
    };

    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(persist);
    } else {
      setTimeout(persist, 0);
    }
  }

  isInlineImage(url?: string | null): boolean {
    if (!url) return false;
    return url.startsWith('data:') || url.startsWith('blob:');
  }

  loadRecipes(): void {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) {
      console.warn('[Storefront] Skipping loadRecipes: No tenant slug identified yet.');
      this.appLoadService.setStorefrontReady(true);
      return;
    }
    const headers = new HttpHeaders().set('x-tenant-slug', slug);
    const cached = localStorage.getItem('bakery_recipes');
    if (cached) {
      try {
        const normalized = this.normalizeRecipeImages(JSON.parse(cached));
        this.products.set(normalized);
        this.scheduleOptimizedRecipeCache(normalized);
        this.appLoadService.setStorefrontReady(true);
      } catch (e) {
        console.warn('Failed to load cached recipes from localStorage', e);
        this.appLoadService.setStorefrontReady(true);
      }
    } else {
      this.appLoadService.setStorefrontReady(true);
    }
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes: CalculatedRecipe[]) => {
        const normalized = this.normalizeRecipeImages(recipes);
        this.products.set(normalized);
        // Sync local storage just in case other parts of the app still rely on it
        this.scheduleOptimizedRecipeCache(normalized);

        this.appLoadService.setStorefrontReady(true);
      },
      error: (err: any) => {
        console.error('Failed to load recipes from database:', err);
        // Fallback to local storage if DB fails
        const saved = localStorage.getItem('bakery_recipes');
        if (saved) {
          const normalized = this.normalizeRecipeImages(JSON.parse(saved));
          this.products.set(normalized);
          this.scheduleOptimizedRecipeCache(normalized);
        }
        this.appLoadService.setStorefrontReady(true);
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
        this.scheduleOptimizedRecipeCache(updated);
        this.cancelDelete();
      },
      error: (err) => {
        console.error('Failed to delete product from cloud:', err);
        // Fallback to local delete
        const updated = this.products().filter(p => p.id !== product.id);
        this.products.set(updated);
        this.scheduleOptimizedRecipeCache(updated);
        this.cancelDelete();
      }
    });
  }

  deleteProduct(product: CalculatedRecipe): void {
    this.confirmDeleteProduct(product);
  }

  openReviewModal(product: CalculatedRecipe) {
    this.selectedProductForReview.set(product);
    if (product.id) {
      this.reviewService.fetchReviewsForRecipe(product.id);
    }
  }

  toggleReviews(productId: string) {
    if (this.showReviewsForProduct() === productId) {
      this.showReviewsForProduct.set(null);
    } else {
      this.reviewService.fetchReviewsForRecipe(productId);
      this.showReviewsForProduct.set(productId);
    }
  }

  getReviews(productId: string): Review[] {
    return this.reviewService.getReviewsForRecipe(productId)();
  }

  showHint() {
    const hint = this.helpService.getHint('storefront');
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }
}
