import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe } from '@angular/common';
import { CalculatedRecipe, RecipeCategory, FlavorProfile, Review } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ReviewService } from '../../services/review.service';
import { Router } from '@angular/router';
import { ReviewModalComponent } from '../review-modal/review-modal';

@Component({
  selector: 'app-storefront',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, TitleCasePipe, ReviewModalComponent],
  templateUrl: './storefront.html',
  styleUrls: ['./storefront.css']
})
export class StorefrontComponent implements OnInit {
  private cartService = inject(CartService);
  protected authService = inject(AuthService);
  protected reviewService = inject(ReviewService);
  private router = inject(Router);

  products = signal<CalculatedRecipe[]>([]);
  categories = signal<RecipeCategory[]>(['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'OTHER']);
  selectedCategory = signal<RecipeCategory | 'ALL'>('ALL');
  selectedFlavor = signal<FlavorProfile | 'ALL'>('ALL');

  selectedProductForReview = signal<CalculatedRecipe | null>(null);
  showReviewsForProduct = signal<string | null>(null);
  showSubscriptionInfo = signal(false);
  searchTerm = signal('');

  filteredProducts = computed(() => {
    const category = this.selectedCategory();
    const flavor = this.selectedFlavor();
    const search = this.searchTerm().toLowerCase();

    return this.products().filter(p => {
      const matchCategory = (category === 'ALL' && p.category !== 'SPECIAL') || p.category === category;
      const matchFlavor = flavor === 'ALL' || p.flavorProfile === flavor;
      const matchSearch = p.name.toLowerCase().includes(search) ||
                          p.description?.toLowerCase().includes(search);
      return matchCategory && matchFlavor && matchSearch;
    });
  });

  topRatedByCategory = computed(() => {
    const products = this.products();
    const categories: RecipeCategory[] = ['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'OTHER'];
    const topRated: Record<string, string> = {};

    categories.forEach(cat => {
      const catProducts = products.filter(p => p.category === cat && (p.averageRating || 0) > 0);
      if (catProducts.length > 0) {
        const top = catProducts.reduce((prev, current) =>
          (prev.averageRating || 0) > (current.averageRating || 0) ? prev : current
        );
        if (top.id) topRated[cat] = top.id;
      }
    });

    return topRated;
  });

  isTopRated(product: CalculatedRecipe): boolean {
    return this.topRatedByCategory()[product.category] === product.id;
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

  ngOnInit(): void {
    const saved = localStorage.getItem('bakery_recipes');
    if (saved) {
      this.products.set(JSON.parse(saved));
    }
  }

  addToCart(product: CalculatedRecipe): void {
    this.cartService.addToCart(product);
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

  deleteProduct(product: CalculatedRecipe): void {
    if (!product.id) return;
    if (confirm(`Are you sure you want to delete ${product.name}?`)) {
      const updated = this.products().filter(p => p.id !== product.id);
      this.products.set(updated);
      localStorage.setItem('bakery_recipes', JSON.stringify(updated));
    }
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
    const saved = localStorage.getItem('bakery_reviews');
    if (saved) {
      const all: Review[] = JSON.parse(saved);
      return all.filter(r => r.recipeId === productId);
    }
    return [];
  }
}
