import { Component, OnInit, signal, computed, inject, effect, OnDestroy } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule, DecimalPipe, PercentPipe } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { calculateBakersMath, Recipe, CalculatedRecipe, IngredientType, scaleRecipe, MOCK_INGREDIENTS_DB, RecipeCategory, FlavorProfile } from '../../logic/bakers-math';
import { AuthService } from '../../services/auth.service';
import { IngredientService, FoodSearchItem } from '../../services/ingredient.service';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, takeUntil, of, catchError } from 'rxjs';

@Component({
  selector: 'app-recipe-calculator',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DecimalPipe, PercentPipe],
  templateUrl: './recipe-calculator.html',
  styleUrls: ['./recipe-calculator.css']
})
export class RecipeCalculatorComponent implements OnInit, OnDestroy {
  protected authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ingredientService = inject(IngredientService);
  private modalService = inject(ModalService);
  private helpService = inject(HelpService);
  private tenantService = inject(TenantService);
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);

  currentTenant = this.tenantService.tenant;

  recipeForm: FormGroup;
  ingredientTypes: IngredientType[] = ['FLOUR', 'WATER', 'LEVAIN', 'SALT', 'INCLUSION'];
  recipeCategories: RecipeCategory[] = ['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'SCONE', 'SPECIAL', 'OTHER'];
  flavorProfiles: FlavorProfile[] = ['SWEET', 'SAVORY', 'PLAIN'];
  knownIngredients = Object.keys(MOCK_INGREDIENTS_DB);

  searchResults = signal<FoodSearchItem[]>([]);
  activeSearchIndex = signal<number | null>(null);
  private searchSubject = new Subject<{ term: string, index: number }>();
  private destroy$ = new Subject<void>();

  calculatedRecipe = signal<CalculatedRecipe | undefined>(undefined);
  savedRecipes = signal<CalculatedRecipe[]>([]);
  ingredientCostDefaults = signal<Record<string, { bulkPrice?: number; bulkWeight?: number; costPerUnit?: number }>>({});

  showNotifications = signal<boolean>(false);
  recipeToDelete = signal<CalculatedRecipe | null>(null);
  customWeight = signal<number>(100);

  customCalories = computed(() => {
    const recipe = this.calculatedRecipe();
    if (!recipe || recipe.totalNutrition.calories === 0) return 0;

    const totalWeight = recipe.ingredients.reduce((acc, ing) => acc + ing.weight, 0);
    if (totalWeight === 0) return 0;

    return (this.customWeight() / totalWeight) * recipe.totalNutrition.calories;
  });

  hasUnsavedChanges = signal<boolean>(false);
  isSaving = signal<boolean>(false);
  private isLoadingRecipe = false;
  private pendingRecipeId: string | null = null;

  constructor() {
    this.recipeForm = this.fb.group({
      id: [null],
      name: ['New Recipe'],
      category: ['BREAD'],
      flavorProfile: [null],
      description: ['A handcrafted loaf featuring organic ingredients and long fermentation for depth of flavor.'],
      price: [12],
      imageUrl: [''],
      images: this.fb.array([]),
      levainHydration: [100],
      servingSizeGrams: [50],
      prepTimeMinutes: [0],
      bakeTimeMinutes: [45],
      isHidden: [false],
      sku: [''],
      barcode: [''],
      productType: ['PHYSICAL'],
      currentUnits: [1],
      targetUnits: [1],
      ingredients: this.fb.array([
        this.createIngredient('Bread Flour', 400, 'FLOUR', 0.15),
        this.createIngredient('Water', 300, 'WATER', 0),
        this.createIngredient('Starter', 75, 'LEVAIN', 0.15),
        this.createIngredient('Salt', 10, 'SALT', 0.05),
      ])
    });

    // React to tenant changes to reload recipes
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        console.log('[RecipeCalculator] Tenant identified, loading recipes:', tenant.slug);
        this.loadSavedRecipes();
        this.loadIngredientCosts();
      }
    });
  }

  ngOnInit(): void {
    if (!this.authService.isBaker()) {
      this.router.navigate(['/front']);
      return;
    }

    // Debounced search setup
    this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged((prev, curr) => prev.term === curr.term && prev.index === curr.index),
      switchMap(({ term, index }) => {
        console.log('Debounced search triggered for:', term);
        if (term.length >= 2) {
          return this.ingredientService.search(term).pipe(
            catchError((err: any) => {
              console.error('Search error in component:', err);
              return of([]);
            })
          );
        } else {
          return of([]);
        }
      }),
      takeUntil(this.destroy$)
    ).subscribe((results: FoodSearchItem[]) => {
      console.log('Search results received:', results.length);
      this.searchResults.set(results);
    });

    this.route.paramMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const recipeId = params.get('id');
        if (recipeId) {
          this.tryLoadRecipeById(recipeId);
        } else {
          this.pendingRecipeId = null;
        }
      });

    this.recipeForm.valueChanges.subscribe(() => {
      if (!this.isLoadingRecipe) {
        this.hasUnsavedChanges.set(true);
        this.saveDraft();
      }
      this.updateCalculations();
    });
    this.updateCalculations();

    // Check for draft
    this.loadDraft();
  }

  private saveDraft(): void {
    const draft = this.recipeForm.getRawValue();
    try {
      localStorage.setItem('recipe_calculator_draft', JSON.stringify(draft));
    } catch (e) {
      console.warn('Failed to save draft to localStorage (quota exceeded)', e);
    }
  }

  private loadDraft(): void {
    const saved = localStorage.getItem('recipe_calculator_draft');
    if (saved && !this.route.snapshot.paramMap.get('id')) {
      try {
        const draft = JSON.parse(saved);
        this.modalService.showConfirm(
          'You have an unsaved recipe draft. Would you like to restore it?',
          'Unsaved Draft Found',
          () => {
            this.isLoadingRecipe = true;
            this.loadRecipeIntoForm(draft);
            this.isLoadingRecipe = false;
            this.hasUnsavedChanges.set(true);
            localStorage.removeItem('recipe_calculator_draft');
          },
          () => {
            localStorage.removeItem('recipe_calculator_draft');
          }
        );
      } catch (e) {
        console.error('Error loading draft', e);
      }
    }
  }

  private loadRecipeIntoForm(recipe: any): void {
    this.recipeForm.patchValue({
      id: recipe.id,
      name: recipe.name,
      category: recipe.category,
      flavorProfile: recipe.flavorProfile || null,
      description: recipe.description || '',
      price: recipe.price || 12,
      imageUrl: recipe.imageUrl || '',
      levainHydration: (recipe.levainDetails?.hydration ?? 1) * 100 || recipe.levainHydration,
      servingSizeGrams: recipe.servingSizeGrams || 50,
      isHidden: recipe.isHidden || false,
      currentUnits: recipe.currentUnits || 1,
      targetUnits: recipe.targetUnits || 1
    });

    const imagesArray = this.recipeForm.get('images') as FormArray;
    imagesArray.clear();
    if (recipe.images) {
      recipe.images.forEach((img: string) => imagesArray.push(this.fb.control(img)));
    } else if (recipe.imageUrl) {
      imagesArray.push(this.fb.control(recipe.imageUrl));
    }

    const ingredientsArray = this.recipeForm.get('ingredients') as FormArray;
    ingredientsArray.clear();
    recipe.ingredients.forEach((ing: any) => {
      ingredientsArray.push(this.createIngredient(ing.name, ing.weight, ing.type, ing.costPerUnit, ing.bulkPrice, ing.bulkWeight));
    });
    this.updateCalculations();
  }

  private buildCloneName(baseName: string): string {
    const trimmed = baseName.trim() || 'New Recipe';
    const existingNames = new Set(this.savedRecipes().map(recipe => recipe.name.toLowerCase()));
    const baseCopyName = `${trimmed} (Copy)`;
    if (!existingNames.has(baseCopyName.toLowerCase())) {
      return baseCopyName;
    }
    let counter = 2;
    let candidate = `${trimmed} (Copy ${counter})`;
    while (existingNames.has(candidate.toLowerCase())) {
      counter += 1;
      candidate = `${trimmed} (Copy ${counter})`;
    }
    return candidate;
  }

  cloneRecipe(): void {
    const current = this.recipeForm.getRawValue();
    const cloneName = this.buildCloneName(current.name || 'New Recipe');

    this.isLoadingRecipe = true;
    this.recipeForm.patchValue({
      id: null,
      name: cloneName
    }, { emitEvent: false });
    this.isLoadingRecipe = false;

    if (this.route.snapshot.paramMap.get('id')) {
      this.router.navigate(['/calculator'], { replaceUrl: true });
    }

    this.hasUnsavedChanges.set(true);
    this.saveDraft();
    this.updateCalculations();
    this.modalService.showAlert('Recipe cloned. Update any details and save to create a new recipe.', 'Clone Ready', 'success');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private tryLoadRecipeById(recipeId: string | null): void {
    if (!recipeId) return;
    const recipe = this.savedRecipes().find(r => r.id === recipeId);
    if (recipe) {
      this.loadRecipe(recipe);
      this.pendingRecipeId = null;
    } else {
      this.pendingRecipeId = recipeId;
    }
  }

  loadSavedRecipes(): void {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) {
      console.warn('[RecipeCalculator] Skipping loadSavedRecipes: No tenant slug identified yet.');
      return;
    }
    const headers = new HttpHeaders().set('x-tenant-slug', slug);
    this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).subscribe({
      next: (recipes) => {
        this.savedRecipes.set(recipes);
        try {
          localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(recipes)));
        } catch (e) {
          console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
        }
        this.tryLoadRecipeById(this.pendingRecipeId);
      },
      error: (err) => console.error('Error loading recipes', err)
    });
  }

  getRecipeCategory(recipeName: string): string {
    const recipe = this.savedRecipes().find(r => r.name === recipeName);
    return recipe?.category || 'BREAD';
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

  resetForm(): void {
    this.recipeForm.reset({
      id: null,
      name: 'New Recipe',
      category: 'BREAD',
      flavorProfile: null,
      description: 'A handcrafted loaf featuring organic ingredients and long fermentation for depth of flavor.',
      price: 12,
      imageUrl: '',
      levainHydration: 100,
      servingSizeGrams: 50,
      prepTimeMinutes: 0,
      bakeTimeMinutes: 45,
      isHidden: false,
      currentUnits: 1,
      targetUnits: 1
    });

    // Clear images FormArray
    const imagesArray = this.recipeForm.get('images') as FormArray;
    while (imagesArray.length !== 0) {
      imagesArray.removeAt(0);
    }

    // Reset ingredients to defaults
    const ingredientsArray = this.recipeForm.get('ingredients') as FormArray;
    while (ingredientsArray.length !== 0) {
      ingredientsArray.removeAt(0);
    }
    ingredientsArray.push(this.createIngredient('Bread Flour', 400, 'FLOUR', 0.15));
    ingredientsArray.push(this.createIngredient('Water', 300, 'WATER', 0));
    ingredientsArray.push(this.createIngredient('Starter', 75, 'LEVAIN', 0.15));
    ingredientsArray.push(this.createIngredient('Salt', 10, 'SALT', 0.05));

    this.hasUnsavedChanges.set(false);
    localStorage.removeItem('recipe_calculator_draft');
    this.updateCalculations();
  }

  async saveRecipe(): Promise<void> {
    if (this.isSaving()) return;

    const current = this.calculatedRecipe();
    const tenant = this.tenantService.tenant();
    const slug = tenant?.slug;

    if (current && slug) {
      this.isSaving.set(true);

      // Check if user has tenant_id in metadata, if not, sync it
      const user = this.authService.user();
      if (user && !user.tenant_id && tenant.id) {
        console.log('[Recipe Calculator] Syncing tenant_id to user metadata...');
        try {
          await this.authService.syncTenantToMetadata(tenant.id, slug);
          this.modalService.showAlert('User metadata synced successfully! The page will reload to apply changes.', 'Success', 'success');
          // Reload the page to ensure the new JWT is used
          setTimeout(() => window.location.reload(), 2000);
          return;
        } catch (error) {
          console.error('[Recipe Calculator] Failed to sync tenant metadata:', error);
          this.modalService.showAlert('Failed to sync user permissions. Please try logging out and back in.', 'Error', 'error');
          this.isSaving.set(false);
          return;
        }
      }

      const headers = new HttpHeaders().set('x-tenant-slug', slug);
      const rawIngredients = this.recipeForm.getRawValue().ingredients || [];
      this.persistIngredientCostDefaults(rawIngredients);
      this.http.post<CalculatedRecipe>(`${environment.apiUrl}/orders/recipes`, current, { headers }).subscribe({
        next: (saved: CalculatedRecipe) => {
          this.isSaving.set(false);
          this.savedRecipes.update(prev => {
            const index = prev.findIndex(r => r.id === saved.id);
            if (index !== -1) {
              prev[index] = saved;
            } else {
              prev.push(saved);
            }
            try {
              localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(prev)));
            } catch (e) {
              console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
            }
            return [...prev];
          });
          // Update form with the ID from the database if it's a new recipe
          if (saved.id && !this.recipeForm.get('id')?.value) {
            this.recipeForm.patchValue({ id: saved.id }, { emitEvent: false });
          }
          this.modalService.showAlert('Recipe saved to cloud successfully! ☁️', 'Success', 'success');
          this.hasUnsavedChanges.set(false);
          localStorage.removeItem('recipe_calculator_draft');
        },
        error: (err: any) => {
          this.isSaving.set(false);
          console.error('Failed to save recipe to cloud:', err);
          let errorMessage = 'Failed to save to cloud. Saving locally for now.';
          if (err.status === 404) {
            errorMessage = 'Your bakery profile was not found. Please ensure you have completed the setup wizard.';
          } else if (err.error?.details) {
            errorMessage = `Cloud save failed: ${err.error.details}`;
          }
          this.modalService.showAlert(errorMessage, 'Save Warning', 'warning');
          // Fallback to old local save logic
          this.saveLocally(current);
        }
      });
    }
  }

  private saveLocally(recipeToSave: CalculatedRecipe): void {
    this.savedRecipes.update(prev => {
      let updated: CalculatedRecipe[];
      if (recipeToSave.id) {
        updated = prev.map(r => r.id === recipeToSave.id ? recipeToSave : r);
      } else {
        recipeToSave.id = Date.now().toString();
        updated = [...prev, recipeToSave];
        this.recipeForm.patchValue({ id: recipeToSave.id }, { emitEvent: false });
    }
    try {
      localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(updated)));
    } catch (e) {
      console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
    }
    this.hasUnsavedChanges.set(false);
    localStorage.removeItem('recipe_calculator_draft');
    return updated;
  });
}

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      const imagesArray = this.recipeForm.get('images') as FormArray;

      for (let i = 0; i < files.length; i++) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          imagesArray.push(this.fb.control(result));

          if (!this.recipeForm.get('imageUrl')?.value) {
            this.recipeForm.patchValue({ imageUrl: result });
          }

          // Force calculation update to ensure new images are in the signal
          this.updateCalculations();
        };
        reader.readAsDataURL(files[i]);
      }
    }
  }

  removeImage(index: number): void {
    const imagesArray = this.recipeForm.get('images') as FormArray;
    imagesArray.removeAt(index);
    if (imagesArray.length === 0) {
      this.recipeForm.patchValue({ imageUrl: '' });
    } else {
      this.recipeForm.patchValue({ imageUrl: imagesArray.at(0).value });
    }
    this.updateCalculations();
  }

  loadRecipe(recipe: CalculatedRecipe): void {
    this.isLoadingRecipe = true;
    this.loadRecipeIntoForm(recipe);
    this.isLoadingRecipe = false;
    this.hasUnsavedChanges.set(false);
  }

  deleteRecipe(id: string | undefined): void {
    if (!id) return;
    console.log('Attempting to delete recipe with ID:', id);
    const headers = new HttpHeaders().set('x-tenant-slug', this.tenantService.tenant()?.slug || 'the-daily-dough');
    this.http.delete(`${environment.apiUrl}/orders/recipes/${id}`, { headers }).subscribe({
      next: () => {
        console.log('Delete successful for ID:', id);
        const updated = this.savedRecipes().filter(r => r.id !== id);
        this.savedRecipes.set(updated);
        try {
          localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(updated)));
        } catch (e) {
          console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
        }
      },
      error: (err) => {
        console.error('Error deleting recipe', err);
        // Fallback for local-only recipes or server failure
        const updated = this.savedRecipes().filter(r => r.id !== id);
        this.savedRecipes.set(updated);
        try {
          localStorage.setItem('bakery_recipes', JSON.stringify(this.getOptimizedRecipesForStorage(updated)));
        } catch (e) {
          console.warn('Failed to save recipes to localStorage (quota exceeded)', e);
        }
      }
    });
  }

  confirmDeleteRecipe(recipe: CalculatedRecipe): void {
    this.recipeToDelete.set(recipe);
  }

  cancelDelete(): void {
    this.recipeToDelete.set(null);
  }

  executeDelete(): void {
    const recipe = this.recipeToDelete();
    console.log('executeDelete called, recipeToDelete is:', recipe);
    if (recipe && recipe.id) {
      this.deleteRecipe(recipe.id);
    } else {
      console.warn('Cannot execute delete: recipe or recipe.id is missing', recipe);
    }
    this.cancelDelete();
  }

  get ingredients(): FormArray {
    return this.recipeForm.get('ingredients') as FormArray;
  }

  onSearch(event: Event, index: number) {
    const term = (event.target as HTMLInputElement).value;
    console.log('Search term:', term, 'at index:', index);
    this.activeSearchIndex.set(index);
    this.searchSubject.next({ term, index });
    if (term.length < 2) {
      this.searchResults.set([]);
    }
  }

  onBlur() {
    // Delay slightly to allow mousedown to trigger selectIngredient
    setTimeout(() => {
      this.activeSearchIndex.set(null);
      this.searchResults.set([]);
    }, 200);
  }

  onIngredientBlur(index: number) {
    this.onBlur();
    this.applyIngredientCostDefaults(index);
  }

  selectIngredient(item: FoodSearchItem, index: number) {
    console.log('Ingredient selected:', item.name, 'for index:', index);
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    ingredientForm.patchValue({ name: item.name });

    this.applyIngredientCostDefaults(index, item.name);

    // Add to local DB so getNutrition can find it later
    this.ingredientService.addIngredient(item.name, item.nutrition);

    this.searchResults.set([]);
    this.activeSearchIndex.set(null);
    this.updateCalculations();
  }

  private loadIngredientCosts() {
    const headers = this.getTenantHeaders();
    if (!headers) return;

    this.http.get<Array<{ name: string; bulkPrice?: number; bulkWeight?: number; costPerUnit?: number }>>(
      `${environment.apiUrl}/orders/ingredients/costs`,
      { headers }
    ).subscribe({
      next: (costs) => {
        const map: Record<string, { bulkPrice?: number; bulkWeight?: number; costPerUnit?: number }> = {};
        costs.forEach(item => {
          if (item.name) {
            const normalizedName = this.normalizeIngredientName(item.name);
            const payload = {
              bulkPrice: item.bulkPrice ?? undefined,
              bulkWeight: item.bulkWeight ?? undefined,
              costPerUnit: item.costPerUnit ?? undefined
            };
            map[item.name] = payload;
            map[normalizedName] = payload;
          }
        });
        this.ingredientCostDefaults.set(map);
        this.applyIngredientCostDefaultsToAll();
      },
      error: (err) => {
        console.warn('Failed to load ingredient cost defaults:', err);
      }
    });
  }

  private getTenantHeaders(): HttpHeaders | null {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return null;
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  private applyIngredientCostDefaults(index: number, nameOverride?: string) {
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    const name = (nameOverride ?? (ingredientForm.get('name')?.value || '')).trim();
    if (!name) return;

    const defaults = this.ingredientCostDefaults()[this.normalizeIngredientName(name)]
      || this.ingredientCostDefaults()[name];
    if (!defaults) return;

    const bulkPrice = ingredientForm.get('bulkPrice')?.value;
    const bulkWeight = ingredientForm.get('bulkWeight')?.value;
    const costPerUnit = ingredientForm.get('costPerUnit')?.value;

    ingredientForm.patchValue({
      bulkPrice: bulkPrice ? bulkPrice : (defaults.bulkPrice ?? bulkPrice),
      bulkWeight: bulkWeight ? bulkWeight : (defaults.bulkWeight ?? bulkWeight),
      costPerUnit: costPerUnit ? costPerUnit : (defaults.costPerUnit ?? costPerUnit)
    }, { emitEvent: false });

    this.updateCalculations();
  }

  private applyIngredientCostDefaultsToAll() {
    this.ingredients.controls.forEach((_, index) => {
      this.applyIngredientCostDefaults(index);
    });
  }

  private persistIngredientCostDefaults(ingredients: Array<{ name: string; bulkPrice?: number; bulkWeight?: number; costPerUnit?: number }>) {
    const headers = this.getTenantHeaders();
    if (!headers) return;

    const payload = ingredients
      .filter(ing => ing.name && ((ing.bulkPrice && ing.bulkWeight) || ing.costPerUnit))
      .map(ing => ({
        name: ing.name.trim(),
        bulkPrice: ing.bulkPrice ?? null,
        bulkWeight: ing.bulkWeight ?? null,
        costPerUnit: ing.costPerUnit ?? null
      }));

    if (payload.length === 0) return;

    this.http.post(`${environment.apiUrl}/orders/ingredients/costs`, payload, { headers }).subscribe({
      next: () => {
        payload.forEach(item => {
          const normalizedName = this.normalizeIngredientName(item.name);
          this.ingredientCostDefaults.update(prev => ({
            ...prev,
            [item.name]: {
              bulkPrice: item.bulkPrice ?? undefined,
              bulkWeight: item.bulkWeight ?? undefined,
              costPerUnit: item.costPerUnit ?? undefined
            },
            [normalizedName]: {
              bulkPrice: item.bulkPrice ?? undefined,
              bulkWeight: item.bulkWeight ?? undefined,
              costPerUnit: item.costPerUnit ?? undefined
            }
          }));
        });
      },
      error: (err) => {
        console.warn('Failed to save ingredient cost defaults:', err);
      }
    });
  }

  private normalizeIngredientName(name: string): string {
    return name.trim().toLowerCase();
  }

  createIngredient(name = '', weight = 0, type: IngredientType = 'FLOUR', cost = 0, bulkPrice = 0, bulkWeight = 0): FormGroup {
    return this.fb.group({
      name: [name],
      weight: [weight],
      type: [type],
      costPerUnit: [cost],
      bulkPrice: [bulkPrice],
      bulkWeight: [bulkWeight]
    });
  }

  addIngredient(): void {
    this.ingredients.push(this.createIngredient());
  }

  removeIngredient(index: number): void {
    this.ingredients.removeAt(index);
  }

  updateCalculations(): void {
    const formValue = this.recipeForm.getRawValue();
    let recipe: Recipe = {
      id: formValue.id,
      name: formValue.name,
      category: formValue.category,
      flavorProfile: formValue.flavorProfile,
      description: formValue.description,
      price: formValue.price,
      imageUrl: formValue.imageUrl,
      images: formValue.images,
      isHidden: formValue.isHidden,
      ingredients: formValue.ingredients.map((ing: any) => ({
        ...ing,
        bulkPrice: ing.bulkPrice,
        bulkWeight: ing.bulkWeight,
        nutrition: this.ingredientService.getNutrition(ing.name)
      })),
      levainDetails: {
        hydration: formValue.levainHydration / 100
      },
      servingSizeGrams: formValue.servingSizeGrams
    };

    if (formValue.targetUnits !== formValue.currentUnits) {
      recipe = scaleRecipe(recipe, formValue.currentUnits, formValue.targetUnits);
    }

    try {
      this.calculatedRecipe.set(calculateBakersMath(recipe));
    } catch (e) {
      console.error('Calculation error', e);
    }
  }

  showHint() {
    const hint = this.helpService.getHint('recipes');
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }
}
