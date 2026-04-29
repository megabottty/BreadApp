import { Component, OnInit, signal, inject, computed, effect } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { ModalService } from '../../services/modal.service';
import { CommonModule, CurrencyPipe, TitleCasePipe, DatePipe, PercentPipe, NgOptimizedImage } from '@angular/common';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe, RecipeCategory, FlavorProfile, Review, calculateBakersMath } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ReviewModalComponent } from '../review-modal/review-modal';
import { TenantService } from '../../services/tenant.service';
import { AppLoadService } from '../../services/app-load.service';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, DatePipe, PercentPipe, FormsModule, NgOptimizedImage, ReviewModalComponent],
  templateUrl: './storefront.html',
  styleUrls: ['./storefront.css']
})
export class StorefrontComponent implements OnInit {
  private cartService = inject(CartService);
  protected authService = inject(AuthService);
  protected reviewService = inject(ReviewService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private http = inject(HttpClient);
  private helpService = inject(HelpService);
  private modalService = inject(ModalService);

  products = signal<CalculatedRecipe[]>([]);
  categories = signal<RecipeCategory[]>(['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'SPECIAL', 'OTHER']);
  selectedCategory = signal<RecipeCategory | 'ALL'>('ALL');
  selectedFlavor = signal<FlavorProfile | 'ALL'>('ALL');

  selectedProductForReview = signal<CalculatedRecipe | null>(null);
  selectedProductDetails = signal<CalculatedRecipe | null>(null);
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
    this.route.queryParamMap.subscribe(params => {
      this.searchTerm.set(params.get('q') || '');
    });
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

    // Local caching removed per user request
    /*
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
    */

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

  onProductCardClick(product: CalculatedRecipe, event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Ignore clicks on already interactive controls inside the card.
    if (target.closest('button, a, input, textarea, select, .rating-display, .reviews-list, .reply-editor')) {
      return;
    }

    this.openProductDetails(product);
  }

  openProductDetails(product: CalculatedRecipe): void {
    this.selectedProductDetails.set(product);
  }

  closeProductDetails(): void {
    this.selectedProductDetails.set(null);
  }

  getNutritionDisplay(product: CalculatedRecipe): {
    hasData: boolean;
    label: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  } {
    const isCinnamonRoll = (product.name || '').toLowerCase().includes('cinnamon roll');
    const nutritionDivisor = isCinnamonRoll ? 12 : 1;
    const nutritionLabel = isCinnamonRoll ? 'Per cinnamon roll (1 of 12)' : null;

    const hasIngredients = Array.isArray(product.ingredients) && product.ingredients.length > 0;
    const fallback = (!product.totalNutrition || product.totalNutrition.calories === 0) && hasIngredients
      ? calculateBakersMath({
        ...product,
        ingredients: product.ingredients
      })
      : product;

    const totalNutrition = fallback.totalNutrition;
    const perServing = fallback.nutritionPerServing;

    if (perServing && perServing.calories > 0) {
      return {
        hasData: true,
        label: nutritionLabel || `Per serving (${fallback.servingSizeGrams || product.servingSizeGrams || 50}g)`,
        calories: perServing.calories / nutritionDivisor,
        protein: perServing.protein / nutritionDivisor,
        carbs: perServing.carbs / nutritionDivisor,
        fat: perServing.fat / nutritionDivisor
      };
    }

    if (totalNutrition && totalNutrition.calories > 0) {
      return {
        hasData: true,
        label: nutritionLabel || 'Per whole item',
        calories: totalNutrition.calories / nutritionDivisor,
        protein: totalNutrition.protein / nutritionDivisor,
        carbs: totalNutrition.carbs / nutritionDivisor,
        fat: totalNutrition.fat / nutritionDivisor
      };
    }

    return {
      hasData: false,
      label: 'Nutrition data unavailable',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    };
  }

  subscribe(product: CalculatedRecipe): void {
    // Add to cart with subscription pre-toggled
    this.cartService.addToCart(product);
    this.cartService.toggleSubscription(product.id || '');
    this.router.navigate(['/cart']);
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

  editProduct(product: CalculatedRecipe): void {
    if (!product) {
      console.error('[Storefront] editProduct called with null product');
      return;
    }

    const recipeId = product.id || (product as any)._id;
    console.log('[Storefront] Attempting to edit product:', {
      name: product.name,
      id: product.id,
      _id: (product as any)._id
    });

    if (!recipeId) {
      console.error('[Storefront] editProduct: product missing ID', product);
      // Try to find by name in the products signal if id is missing
      const found = this.products().find(p => p.name === product.name && p.id);
      if (found && found.id) {
        console.log('[Storefront] Found product ID from signal by name:', found.id);
        this.router.navigate(['/calculator', found.id]);
        return;
      }
      alert('Could not find an ID for this recipe to edit. Please try reloading the page.');
      return;
    }

    console.log('[Storefront] Navigating to /calculator/' + recipeId);

    // Using a tiny timeout to ensure we're out of any current event loop / change detection cycle
    // and that stopPropagation has fully taken effect if it was a race condition.
    setTimeout(() => {
      this.router.navigate(['/calculator', recipeId])
        .then(success => {
          if (success) {
            console.log('[Storefront] Navigation successful to /calculator/' + recipeId);
          } else {
            console.error('[Storefront] Navigation FAILED to /calculator/' + recipeId);
            // Fallback: direct window location if router fails for some reason
            // window.location.href = `/calculator/${recipeId}`;
          }
        })
        .catch(err => {
          console.error('[Storefront] Error during navigation:', err);
        });
    }, 10);
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
