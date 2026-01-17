import { Component, OnInit, signal, inject, computed } from '@angular/core';
import { CommonModule, CurrencyPipe, TitleCasePipe, PercentPipe } from '@angular/common';
import { CalculatedRecipe } from '../../logic/bakers-math';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-experimental-kitchen',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, PercentPipe],
  templateUrl: './experimental-kitchen.html',
  styleUrls: ['./experimental-kitchen.css']
})
export class ExperimentalKitchenComponent implements OnInit {
  private cartService = inject(CartService);
  protected authService = inject(AuthService);
  private router = inject(Router);

  products = signal<CalculatedRecipe[]>([]);

  experimentalProducts = computed(() => {
    return this.products().filter(p => p.category === 'SPECIAL');
  });

  topRatedSpecialId = computed(() => {
    const specials = this.experimentalProducts().filter(p => (p.averageRating || 0) > 0);
    if (specials.length === 0) return null;
    const top = specials.reduce((prev, current) =>
      (prev.averageRating || 0) > (current.averageRating || 0) ? prev : current
    );
    return top.id;
  });

  isTopRated(product: CalculatedRecipe): boolean {
    return this.topRatedSpecialId() === product.id;
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
    this.cartService.addToCart(product);
    this.cartService.toggleSubscription(product.id || '');
    this.router.navigate(['/cart']);
  }

  editProduct(product: CalculatedRecipe): void {
    this.router.navigate(['/calculator', product.id]);
  }

  deleteProduct(product: CalculatedRecipe): void {
    if (!product.id) return;
    if (confirm(`Are you sure you want to delete this experiment: ${product.name}?`)) {
      const saved = localStorage.getItem('bakery_recipes');
      if (saved) {
        const recipes: CalculatedRecipe[] = JSON.parse(saved);
        const updated = recipes.filter(p => p.id !== product.id);
        localStorage.setItem('bakery_recipes', JSON.stringify(updated));
        this.products.set(updated);
      }
    }
  }
}
