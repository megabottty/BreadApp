import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe } from '../logic/bakers-math';
import { TenantService } from './tenant.service';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);

  savedRecipes = signal<CalculatedRecipe[]>([]);

  private get headers() {
    const slug = this.tenantService.tenant()?.slug || 'the-daily-dough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  private normalizeRecipeImages(recipes: CalculatedRecipe[]): CalculatedRecipe[] {
    return recipes.map(recipe => {
      if (recipe.images && recipe.images.length > 0) return recipe;
      if (recipe.imageUrl) return { ...recipe, images: [recipe.imageUrl] };
      return recipe;
    });
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
      ingredients: r.ingredients?.map(ing => ({ name: ing.name, weight: ing.weight, type: ing.type }))
    }));
  }

  private scheduleOptimizedRecipeCache(recipes: CalculatedRecipe[]) {
    const persist = () => {
      try {
        localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(recipes)));
      } catch (e) {
        // ignore quota errors
      }
    };

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(persist);
    } else {
      setTimeout(persist, 0);
    }
  }

  loadRecipes(): void {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return;

    const headers = this.headers;
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes) => {
        const normalized = this.normalizeRecipeImages(recipes);
        this.savedRecipes.set(normalized);
        this.scheduleOptimizedRecipeCache(normalized);
      },
      error: (err) => {
        console.error('[RecipeService] Failed to load recipes:', err);
        const saved = localStorage.getItem('bakery_recipes');
        if (saved) {
          try {
            const normalized = this.normalizeRecipeImages(JSON.parse(saved));
            this.savedRecipes.set(normalized);
          } catch (e) {
            // ignore parse errors
          }
        }
      }
    });
  }

  refresh() {
    this.loadRecipes();
  }

  getById(id: string) {
    return this.savedRecipes().find(r => r.id === id);
  }

  addLocal(recipe: CalculatedRecipe) {
    this.savedRecipes.update(prev => [...prev, recipe]);
    this.scheduleOptimizedRecipeCache(this.savedRecipes());
  }

  updateLocal(updated: CalculatedRecipe) {
    this.savedRecipes.update(prev => prev.map(r => (r.id === updated.id ? updated : r)));
    this.scheduleOptimizedRecipeCache(this.savedRecipes());
  }

  removeLocal(id: string) {
    this.savedRecipes.update(prev => prev.filter(r => r.id !== id));
    this.scheduleOptimizedRecipeCache(this.savedRecipes());
  }
}
