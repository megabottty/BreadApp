import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { CalculatedRecipe } from '../logic/bakers-math';
import { TenantService } from './tenant.service';
import { environment } from '../../environments/environment';
import { of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private http = inject(HttpClient);
  private tenantService = inject(TenantService);

  savedRecipes = signal<CalculatedRecipe[]>([]);
  isLoading = signal(false);

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
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(recipes)));
      } catch {
        // ignore quota errors
      }
    };

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(persist);
    } else {
      setTimeout(persist, 0);
    }
  }

  /**
   * Public helper to persist recipes to localStorage. Components should call this
   * instead of writing directly to localStorage to keep cache behavior centralized.
   */
  persistToLocalCache(recipes?: CalculatedRecipe[]) {
    const toPersist = recipes || this.savedRecipes();
    this.scheduleOptimizedRecipeCache(toPersist);
  }

  loadRecipes(): void {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return;

    const headers = this.headers;
    this.isLoading.set(true);
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes) => {
        const normalized = this.normalizeRecipeImages(recipes);
        this.savedRecipes.set(normalized);
        this.scheduleOptimizedRecipeCache(normalized);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('[RecipeService] Failed to load recipes:', err);
        if (typeof localStorage !== 'undefined') {
          const saved = localStorage.getItem('bakery_recipes');
          if (saved) {
            try {
              const normalized = this.normalizeRecipeImages(JSON.parse(saved));
              this.savedRecipes.set(normalized);
            } catch {
              // ignore parse errors
            }
          }
        }
        this.isLoading.set(false);
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

  /**
   * Save a recipe to the cloud. On success the savedRecipes signal is updated.
   * On failure the recipe is saved locally (assigned an id if missing) and returned.
   */
  saveRecipe(recipe: CalculatedRecipe) {
    const headers = this.headers;
    return this.http.post<CalculatedRecipe>(`${environment.apiUrl}/orders/recipes`, recipe, { headers }).pipe(
      // update signal on success
      tap((saved: CalculatedRecipe) => {
        const existing = this.savedRecipes().find(r => r.id === saved.id);
        if (existing) {
          this.updateLocal(saved);
        } else {
          this.addLocal(saved);
        }
      }),
      // on error, fallback to saving locally and emit the locally-saved recipe
      catchError((err) => {
        console.warn('[RecipeService] save failed, saving locally', err);
        const local = { ...recipe } as CalculatedRecipe;
        if (!local.id) local.id = Date.now().toString();
        this.addLocal(local);
        return of(local);
      })
    );
  }

  /**
   * Delete a recipe by id. Removes from savedRecipes optimistically; on server error still removes locally.
   */
  deleteRecipe(id: string) {
    const headers = this.headers;
    return this.http.delete<void>(`${environment.apiUrl}/orders/recipes/${id}`, { headers }).pipe(
      tap(() => this.removeLocal(id)),
      catchError((err) => {
        console.warn('[RecipeService] delete failed, removing locally', err);
        this.removeLocal(id);
        return of(undefined);
      })
    );
  }

  // Calculator draft helpers
  saveCalculatorDraft(draft: any) {
    const persist = () => {
      if (typeof localStorage === 'undefined') return;
      try {
        localStorage.setItem('recipe_calculator_draft', JSON.stringify(draft));
      } catch {
        // ignore quota errors
      }
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(persist);
    } else {
      setTimeout(persist, 0);
    }
  }

  loadCalculatorDraft(): any | null {
    if (typeof localStorage === 'undefined') return null;
    const saved = localStorage.getItem('recipe_calculator_draft');
    if (!saved) return null;
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }

  removeCalculatorDraft() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.removeItem('recipe_calculator_draft');
    } catch {
      // ignore
    }
  }
}
