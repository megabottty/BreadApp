import { Component, OnInit, signal, computed, inject, effect, OnDestroy } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule, DecimalPipe, PercentPipe } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { calculateBakersMath, Recipe, CalculatedRecipe, IngredientType, scaleRecipe, MOCK_INGREDIENTS_DB, RecipeCategory, FlavorProfile, NutritionData, PackOption } from '../../logic/bakers-math';
import { calculatePackEconomics, PackEconomics } from '../../logic/pack-options';
import { AuthService } from '../../services/auth.service';
import { IngredientService, FoodSearchItem } from '../../services/ingredient.service';
import { ModalService } from '../../services/modal.service';
import { TenantService } from '../../services/tenant.service';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap, takeUntil, of, catchError, map } from 'rxjs';
import { logger } from '../../utils/logger';
import { RecipeService } from '../../services/recipe.service';
import { IngredientPriceChipComponent } from '../ingredient-price-chip/ingredient-price-chip';
import { PantryService } from '../../services/pantry.service';
import { GramConversion, MEASURE_UNITS, MeasureUnit, parsePackageWeight, toGrams, UnitDefinition } from '../../logic/units';

interface CreateIngredientOptions {
  name?: string;
  weight?: number;
  type?: IngredientType;
  costPerUnit?: number;
  bulkPrice?: number;
  bulkWeight?: number;
  nutrition?: NutritionData | null;
  amount?: number;
  unit?: MeasureUnit;
  gramsPerCup?: number | null;
  gramsPerItem?: number | null;
}

@Component({
  selector: 'app-recipe-calculator',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DecimalPipe, PercentPipe, IngredientPriceChipComponent, RouterLink],
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
  private fb = inject(FormBuilder);
  private recipeService = inject(RecipeService);
  protected pantryService = inject(PantryService);

  currentTenant = this.tenantService.tenant;

  recipeForm: FormGroup;
  ingredientTypes: IngredientType[] = ['FLOUR', 'WATER', 'LEVAIN', 'SALT', 'INCLUSION'];
  protected readonly measureUnits: readonly UnitDefinition[] = MEASURE_UNITS;
  recipeCategories: RecipeCategory[] = ['BREAD', 'PASTRY', 'COOKIE', 'BAGEL', 'MUFFIN', 'SCONE', 'SPECIAL', 'OTHER'];
  flavorProfiles: FlavorProfile[] = ['SWEET', 'SAVORY', 'PLAIN'];
  knownIngredients = Object.keys(MOCK_INGREDIENTS_DB);

  searchResults = signal<FoodSearchItem[]>([]);
  activeSearchIndex = signal<number | null>(null);
  /** Index within `searchResults()` currently highlighted by keyboard/mouse hover. */
  protected activeOptionIndex = signal<number | null>(null);
  private searchSubject = new Subject<{ term: string, index: number }>();
  private destroy$ = new Subject<void>();

  calculatedRecipe = signal<CalculatedRecipe | undefined>(undefined);
  packEconomics = computed<PackEconomics[]>(() => {
    const recipe = this.calculatedRecipe();
    return recipe ? calculatePackEconomics(recipe) : [];
  });
  savedRecipes = this.recipeService.savedRecipes;

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
      itemWeightGrams: [null],
      packOptions: this.fb.array([]),
      prepTimeMinutes: [0],
      bakeTimeMinutes: [45],
      isHidden: [false],
      sku: [''],
      barcode: [''],
      productType: ['PHYSICAL'],
      currentUnits: [1],
      targetUnits: [1],
      ingredients: this.fb.array([
        this.createIngredient({ name: 'Bread Flour', weight: 400, type: 'FLOUR', costPerUnit: 0.15 }),
        this.createIngredient({ name: 'Water', weight: 300, type: 'WATER', costPerUnit: 0 }),
        this.createIngredient({ name: 'Starter', weight: 75, type: 'LEVAIN', costPerUnit: 0.15 }),
        this.createIngredient({ name: 'Salt', weight: 10, type: 'SALT', costPerUnit: 0.05 }),
      ])
    });

    // React to tenant changes to reload recipes
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        logger.info('[RecipeCalculator] Tenant identified, loading recipes:', tenant.slug);
        this.recipeService.loadRecipes();
        this.pantryService.load();
      }
    });

    // If a recipe ID was requested before recipes finished loading, attempt to load it when recipes arrive
    effect(() => {
      const pendingId = this.pendingRecipeId;
      const recipes = this.recipeService.savedRecipes();
      if (pendingId && recipes.length > 0) {
        this.tryLoadRecipeById(pendingId);
        this.pendingRecipeId = null;
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
      debounceTime(400),
      distinctUntilChanged((prev, curr) => prev.term === curr.term && prev.index === curr.index),
      switchMap(({ term, index: _index }) => {
        logger.debug('Debounced search triggered for:', term);
        // We ALWAYS want to include matching pantry ingredients immediately,
        // even before the USDA API returns.
        const knownIngredients = this.buildKnownIngredientResults(term);

        if (term.length >= 2) {
          return this.ingredientService.search(term).pipe(
            map((results: FoodSearchItem[]) => ({ results, known: knownIngredients, term })),
            catchError((err: any) => {
              logger.error('Search error in component:', err);
              return of({ results: [], known: knownIngredients, term });
            })
          );
        } else {
          return of({ results: [], known: knownIngredients, term });
        }
      }),
      takeUntil(this.destroy$)
    ).subscribe(({ results, known, term }: { results: FoodSearchItem[], known: FoodSearchItem[], term: string }) => {
      // If the user has moved to another field, ignore these results
      if (this.activeSearchIndex() === null) return;

      const activeIdx = this.activeSearchIndex();
      const currentTerm = activeIdx !== null ? (this.recipeForm.get('ingredients')?.value[activeIdx]?.name || '') : '';

      // If the user has changed the text significantly while API was pending, ignore
      if (currentTerm.toLowerCase() !== term.toLowerCase() && currentTerm.length > term.length) {
        return;
      }

      logger.debug('Search results received:', results.length, 'Known matched:', known.length);

      // Enhance search results with cost availability flag
      const enhancedResults = results.map((res: FoodSearchItem) => {
        const pantryMatch = this.pantryService.find(res.name);
        const hasCost = !!pantryMatch && pantryMatch.costBasis !== 'MISSING';
        return { ...res, hasCost };
      });

      // Combine: Known products first, then USDA results
      const combined: FoodSearchItem[] = [...known];
      enhancedResults.forEach((res: FoodSearchItem) => {
        if (!combined.some(c => (c.name || '').toLowerCase() === (res.name || '').toLowerCase())) {
          combined.push(res);
        }
      });

      // Sort combined results similarly: prioritize better matches
      const termLower = term.toLowerCase();
      combined.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();

        // Exact matches first
        if (aName === termLower && bName !== termLower) return -1;
        if (bName === termLower && aName !== termLower) return 1;

        // Known products second
        if (a.isKnown && !b.isKnown) return -1;
        if (b.isKnown && !a.isKnown) return 1;

        // Prefix matches third
        if (aName.startsWith(termLower) && !bName.startsWith(termLower)) return -1;
        if (bName.startsWith(termLower) && !aName.startsWith(termLower)) return 1;

        return 0;
      });

      // Only update if we're still focused on this term/index
      this.searchResults.set(combined.slice(0, 15));
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
    this.recipeService.saveCalculatorDraft(draft);
  }

  private loadDraft(): void {
    const saved = this.recipeService.loadCalculatorDraft();
    if (saved && !this.route.snapshot.paramMap.get('id')) {
      try {
        const draft = saved;
        this.modalService.showConfirm(
          'You have an unsaved recipe draft. Would you like to restore it?',
          'Unsaved Draft Found',
          () => {
            this.isLoadingRecipe = true;
            this.loadRecipeIntoForm(draft);
            this.isLoadingRecipe = false;
            this.hasUnsavedChanges.set(true);
            this.recipeService.removeCalculatorDraft();
          },
          () => {
            this.recipeService.removeCalculatorDraft();
          }
        );
      } catch (e) {
        logger.error('Error loading draft', e);
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
      itemWeightGrams: recipe.itemWeightGrams || null,
      prepTimeMinutes: recipe.prepTimeMinutes ?? 0,
      bakeTimeMinutes: recipe.bakeTimeMinutes ?? 45,
      sku: recipe.sku || '',
      barcode: recipe.barcode || '',
      productType: recipe.productType || recipe.product_type || 'PHYSICAL',
      isHidden: recipe.isHidden || false,
      currentUnits: recipe.currentUnits || 1,
      targetUnits: recipe.targetUnits || 1
    });

    const packOptionsArray = this.packOptions;
    packOptionsArray.clear();
    (recipe.packOptions || []).forEach((opt: PackOption) => {
      packOptionsArray.push(this.createPackOption(opt.label, opt.size, opt.price));
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
      ingredientsArray.push(this.createIngredient({
        name: ing.name,
        weight: ing.weight,
        type: ing.type,
        costPerUnit: ing.costPerUnit,
        bulkPrice: ing.bulkPrice,
        bulkWeight: ing.bulkWeight,
        nutrition: ing.nutrition,
        // Legacy (pre-unit-picker) rows have no amount/unit at all --
        // createIngredient backfills amount from weight and unit to 'g'.
        amount: ing.amount,
        unit: ing.unit,
        gramsPerCup: ing.gramsPerCup,
        gramsPerItem: ing.gramsPerItem
      }));
      // Keep saved (e.g. USDA-backfilled) nutrition available to getNutrition()
      if (ing.name && ing.nutrition) {
        this.ingredientService.addIngredient(ing.name, ing.nutrition);
      }
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
    // Delegate to RecipeService. RecipeService handles caching and normalization.
    this.recipeService.loadRecipes();
    // tryLoadRecipeById will be attempted by the effect that watches recipeService.savedRecipes
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
      itemWeightGrams: null,
      prepTimeMinutes: 0,
      bakeTimeMinutes: 45,
      sku: '',
      barcode: '',
      productType: 'PHYSICAL',
      isHidden: false,
      currentUnits: 1,
      targetUnits: 1
    });

    // Clear images FormArray
    const imagesArray = this.recipeForm.get('images') as FormArray;
    while (imagesArray.length !== 0) {
      imagesArray.removeAt(0);
    }
    this.packOptions.clear();

    // Reset ingredients to defaults
    const ingredientsArray = this.recipeForm.get('ingredients') as FormArray;
    while (ingredientsArray.length !== 0) {
      ingredientsArray.removeAt(0);
    }
    ingredientsArray.push(this.createIngredient({ name: 'Bread Flour', weight: 400, type: 'FLOUR', costPerUnit: 0.15 }));
    ingredientsArray.push(this.createIngredient({ name: 'Water', weight: 300, type: 'WATER', costPerUnit: 0 }));
    ingredientsArray.push(this.createIngredient({ name: 'Starter', weight: 75, type: 'LEVAIN', costPerUnit: 0.15 }));
    ingredientsArray.push(this.createIngredient({ name: 'Salt', weight: 10, type: 'SALT', costPerUnit: 0.05 }));

    this.hasUnsavedChanges.set(false);
    this.recipeService.removeCalculatorDraft();
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
        logger.debug('[Recipe Calculator] Syncing tenant_id to user metadata...');
        try {
          await this.authService.syncTenantToMetadata(tenant.id, slug);
          this.modalService.showAlert('User metadata synced successfully! The page will reload to apply changes.', 'Success', 'success');
          // Reload the page to ensure the new JWT is used
          setTimeout(() => window.location.reload(), 2000);
          return;
        } catch (error) {
          logger.error('[Recipe Calculator] Failed to sync tenant metadata:', error);
          this.modalService.showAlert('Failed to sync user permissions. Please try logging out and back in.', 'Error', 'error');
          this.isSaving.set(false);
          return;
        }
      }

      // Ingredient prices already saved to the pantry as they were entered
      // (see PantryService.queueSave, called from onBulkPriceChange /
      // onBulkWeightChange / selectIngredient) -- nothing left to persist here.

      // Delegate network save + local-signal update to RecipeService
      this.recipeService.saveRecipe(current).subscribe({
        next: (saved: CalculatedRecipe) => {
          this.isSaving.set(false);
          // Ensure form gets ID from backend/local fallback
          if (saved.id && !this.recipeForm.get('id')?.value) {
            this.recipeForm.patchValue({ id: saved.id }, { emitEvent: false });
          }

          this.modalService.showAlert('Recipe saved successfully!', 'Success', 'success');
          this.hasUnsavedChanges.set(false);
          this.recipeService.removeCalculatorDraft();
        },
        error: (err: any) => {
          // Service is resilient and should emit a saved recipe even on failure,
          // but keep a defensive error handler for unexpected network/operator errors.
          this.isSaving.set(false);
          logger.error('Failed to save recipe (unexpected):', err);
          this.modalService.showAlert('Failed to save recipe. Changes were saved locally.', 'Save Warning', 'warning');
          // As a final fallback, ensure local copy exists
          this.saveLocally(current);
        }
      });
    }
  }

  private saveLocally(recipeToSave: CalculatedRecipe): void {
    if (recipeToSave.id) {
      this.recipeService.updateLocal(recipeToSave);
    } else {
      const local = { ...recipeToSave } as CalculatedRecipe;
      local.id = Date.now().toString();
      this.recipeService.addLocal(local);
      this.recipeForm.patchValue({ id: local.id }, { emitEvent: false });
    }

    this.hasUnsavedChanges.set(false);
    this.recipeService.removeCalculatorDraft();
  }

  onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      const imagesArray = this.recipeForm.get('images') as FormArray;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = (e: any) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            // Storefront cards display images at ~400px wide; 800px covers
            // retina (2x) displays without shipping oversized files.
            const max_size = 800;

            if (width > height) {
              if (width > max_size) {
                height *= max_size / width;
                width = max_size;
              }
            } else {
              if (height > max_size) {
                width *= max_size / height;
                height = max_size;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

            imagesArray.push(this.fb.control(dataUrl));
            if (!this.recipeForm.get('imageUrl')?.value) {
              this.recipeForm.patchValue({ imageUrl: dataUrl });
            }
            this.updateCalculations();
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
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
    logger.info('Attempting to delete recipe with ID:', id);
    this.recipeService.deleteRecipe(id).subscribe({
      next: () => {
        logger.info('Delete processed for ID:', id);
        // RecipeService already updates the savedRecipes signal and local cache.
      },
      error: (err) => {
        // Should be resilient, but keep logging
        console.error('Error deleting recipe (unexpected):', err);
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
    logger.debug('executeDelete called, recipeToDelete is:', recipe);
    if (recipe && recipe.id) {
      this.deleteRecipe(recipe.id);
    } else {
      logger.warn('Cannot execute delete: recipe or recipe.id is missing', recipe);
    }
    this.cancelDelete();
  }

  get ingredients(): FormArray {
    return this.recipeForm.get('ingredients') as FormArray;
  }

  /** Ingredients from the baker's own pantry matching `term` — shown
   * instantly (before USDA's debounced results) and tagged `isKnown` so the
   * dropdown can surface "her" ingredients ahead of generic nutrition-only
   * records. */
  private buildKnownIngredientResults(term: string): FoodSearchItem[] {
    const termLower = term.toLowerCase();
    return this.pantryService.items()
      .filter(item => !item.isArchived)
      .map(item => ({
        name: item.name,
        nutrition: item.nutrition || this.ingredientService.getNutrition(item.name) || { caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
        isKnown: true,
        hasCost: item.costBasis !== 'MISSING'
      }))
      .filter(ki => ki.name.toLowerCase().includes(termLower));
  }

  onSearch(event: Event, index: number) {
    const term = (event.target as HTMLInputElement).value;
    this.activeSearchIndex.set(index);
    this.activeOptionIndex.set(null);

    const knownIngredients = this.buildKnownIngredientResults(term || '');

    if (!term || term.length < 1) {
      this.searchResults.set(knownIngredients.slice(0, 10));
      // Don't trigger API for empty term
      return;
    }

    // IMMEDIATELY show matching known products
    const filteredKnown = knownIngredients.filter(ki => ki.name.toLowerCase().includes(term.toLowerCase()));

    // If we have local matches, show them immediately to prevent "flashing" while waiting for API
    if (filteredKnown.length > 0) {
      // Sort matches to prioritize exact/prefix
      const termLower = term.toLowerCase();
      filteredKnown.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        if (aName === termLower && bName !== termLower) return -1;
        if (bName === termLower && aName !== termLower) return 1;
        if (aName.startsWith(termLower) && !bName.startsWith(termLower)) return -1;
        if (bName.startsWith(termLower) && !aName.startsWith(termLower)) return 1;
        return aName.localeCompare(bName);
      });

      // Preserve existing API results if they were for the SAME term,
      // otherwise just show known ones until debounced API returns.
      this.searchResults.set(filteredKnown.slice(0, 10));
    }

    this.searchSubject.next({ term, index });
  }

  onBlur(index: number) {
    // Fill in a pantry price if this row doesn't have one yet. Never
    // overwrites a value already sitting in the row -- that clobber (any
    // dropdown-adjacent event silently replacing a price she'd just typed)
    // was a real bug; see selectIngredient for the one place an overwrite is
    // actually correct: an explicit pick from the dropdown.
    this.fillEmptyPriceFromPantry(index);

    // Free-text (never picked from the dropdown) is still a first-class
    // ingredient: if she typed a name with no existing pantry match, save a
    // bare entry now so it's reusable next time, instead of only ever
    // becoming reusable once a price happens to get added.
    this.createBarePantryEntryIfNew(index);

    // Only clear if the blurring index is the active search index
    if (this.activeSearchIndex() === index) {
      setTimeout(() => {
        // Double check we haven't switched to another field or selected something
        if (this.activeSearchIndex() === index) {
          this.activeSearchIndex.set(null);
          this.searchResults.set([]);
          this.activeOptionIndex.set(null);
        }
      }, 400); // Slightly more generous timeout for mobile/slower interactions
    }
  }

  /** Keyboard navigation for the ingredient dropdown -- it was mouse-only
   * (`mousedown` with no `role="listbox"`), making it unusable by keyboard. */
  protected onSearchKeydown(event: KeyboardEvent, index: number): void {
    if (this.activeSearchIndex() !== index || this.searchResults().length === 0) {
      if (event.key === 'Escape') {
        this.activeSearchIndex.set(null);
        this.searchResults.set([]);
        this.activeOptionIndex.set(null);
      }
      return;
    }

    const results = this.searchResults();
    const current = this.activeOptionIndex();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeOptionIndex.set(current === null ? 0 : Math.min(current + 1, results.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeOptionIndex.set(current === null ? results.length - 1 : Math.max(current - 1, 0));
        break;
      case 'Enter':
        if (current !== null && results[current]) {
          event.preventDefault();
          this.selectIngredient(results[current], index);
        }
        break;
      case 'Escape':
        this.activeSearchIndex.set(null);
        this.searchResults.set([]);
        this.activeOptionIndex.set(null);
        break;
    }
  }

  private createBarePantryEntryIfNew(index: number): void {
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    const name = (ingredientForm.get('name')?.value || '').trim();
    if (!name || this.pantryService.find(name)) return;
    this.pantryService.queueSave({ name });
  }

  selectIngredient(item: FoodSearchItem, index: number) {
    logger.debug('Ingredient selected:', item.name, 'for index:', index);

    // Clear dropdown immediately to prevent re-clicks
    this.searchResults.set([]);
    this.activeSearchIndex.set(null);

    const ingredientForm = this.ingredients.at(index) as FormGroup;
    ingredientForm.patchValue({ name: item.name, nutrition: item.nutrition || null });

    // An explicit pick is the one place it's correct to overwrite whatever
    // was in the row -- she just told us exactly which ingredient this is.
    const pantryItem = this.pantryService.find(item.name);
    if (pantryItem) {
      ingredientForm.patchValue({
        bulkPrice: pantryItem.bulkPrice,
        bulkWeight: pantryItem.bulkWeight,
        costPerUnit: pantryItem.costPerUnit,
        type: pantryItem.defaultType || ingredientForm.get('type')?.value
      }, { emitEvent: false });
    }

    // A USDA Branded hit (not yet in her pantry) often carries a package
    // weight, e.g. "16 oz" -- pre-fill it so picking a specific packaged
    // product gets her closer to "add an item, its weight" in one step.
    let pantryPatchBulkWeight: number | undefined;
    if (!pantryItem && item.packageWeight) {
      const parsed = parsePackageWeight(item.packageWeight);
      const grams = parsed ? toGrams(parsed.amount, parsed.unit).grams : 0;
      if (grams > 0) {
        ingredientForm.patchValue({ bulkWeight: grams }, { emitEvent: false });
        pantryPatchBulkWeight = grams;
      }
    }

    // Persist the name + nutrition to the pantry even when there's no price
    // yet -- so this ingredient is reusable next time, instead of being
    // silently dropped for lacking a price (the old behavior).
    this.pantryService.queueSave({
      name: item.name,
      nutrition: item.nutrition ?? null,
      ...(pantryPatchBulkWeight !== undefined ? { bulkWeight: pantryPatchBulkWeight } : {})
    });

    // Add to local DB so getNutrition can find it later
    this.ingredientService.addIngredient(item.name, item.nutrition);

    this.updateCalculations();
  }

  onBulkPriceChange(index: number, value: number | null): void {
    this.ingredients.at(index).patchValue({ bulkPrice: value });
    this.queuePantrySave(index);
  }

  onBulkWeightChange(index: number, value: number | null): void {
    this.ingredients.at(index).patchValue({ bulkWeight: value });
    this.queuePantrySave(index);
  }

  private queuePantrySave(index: number): void {
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    const name = (ingredientForm.get('name')?.value || '').trim();
    if (!name) return;

    this.pantryService.queueSave({
      name,
      bulkPrice: ingredientForm.get('bulkPrice')?.value ?? null,
      bulkWeight: ingredientForm.get('bulkWeight')?.value ?? null
    });
  }

  /** Fills bulkPrice/bulkWeight/type from the pantry only when this row's
   * own values are still empty -- so a value she's already typed is never
   * silently replaced. */
  private fillEmptyPriceFromPantry(index: number): void {
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    const name = (ingredientForm.get('name')?.value || '').trim();
    if (!name) return;

    const pantryItem = this.pantryService.find(name);
    if (!pantryItem) return;

    const currentBulkPrice = ingredientForm.get('bulkPrice')?.value;
    const currentBulkWeight = ingredientForm.get('bulkWeight')?.value;
    if (currentBulkPrice || currentBulkWeight) return; // she already has values here -- leave them alone

    ingredientForm.patchValue({
      bulkPrice: pantryItem.bulkPrice,
      bulkWeight: pantryItem.bulkWeight,
      costPerUnit: pantryItem.costPerUnit
    }, { emitEvent: false });

    this.updateCalculations();
  }

  /** Resolves the current amount+unit for a row into grams, using this
   * ingredient's own saved density/item-weight first, then the pantry's,
   * then (inside `toGrams`) the generic default table by name. */
  protected conversionFor(index: number): GramConversion {
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    const amount = Number(ingredientForm.get('amount')?.value);
    const unit: MeasureUnit = ingredientForm.get('unit')?.value || 'g';
    const name = (ingredientForm.get('name')?.value || '').trim();
    const ownGramsPerCup = ingredientForm.get('gramsPerCup')?.value;
    const ownGramsPerItem = ingredientForm.get('gramsPerItem')?.value;
    const pantryCtx = this.pantryService.conversionContextFor(name);

    return toGrams(Number.isFinite(amount) ? amount : 0, unit, {
      gramsPerCup: ownGramsPerCup ?? pantryCtx.gramsPerCup,
      gramsPerItem: ownGramsPerItem ?? pantryCtx.gramsPerItem,
      ingredientName: name
    });
  }

  /** The only place `weight` (canonical grams) gets written from an
   * amount/unit edit -- called on every change to either field. */
  protected onAmountOrUnitChange(index: number): void {
    const conversion = this.conversionFor(index);
    this.ingredients.at(index).patchValue({ weight: conversion.grams });
  }

  /** True when this row's unit needs a density/item-weight that isn't known
   * specifically for this ingredient yet (pantry or its own saved value) --
   * she's seeing a generic assumption, so we offer a one-time correction
   * that's remembered from here on. */
  protected needsDensityPrompt(index: number): boolean {
    return this.conversionFor(index).assumed;
  }

  protected densityPromptLabel(index: number): string {
    const unit = (this.ingredients.at(index) as FormGroup).get('unit')?.value;
    return unit === 'each' ? 'How much does one weigh? (g)' : 'How much does 1 cup weigh? (g)';
  }

  protected onDensityEntered(index: number, rawValue: string): void {
    const grams = Number(rawValue);
    if (!Number.isFinite(grams) || grams <= 0) return;

    const ingredientForm = this.ingredients.at(index) as FormGroup;
    const name = (ingredientForm.get('name')?.value || '').trim();
    if (!name) return;

    const unit: MeasureUnit = ingredientForm.get('unit')?.value || 'g';
    const patch = unit === 'each' ? { gramsPerItem: grams } : { gramsPerCup: grams };

    ingredientForm.patchValue(patch, { emitEvent: false });
    this.pantryService.queueSave({ name, ...patch });
    this.onAmountOrUnitChange(index);
  }

  createIngredient(opts: CreateIngredientOptions = {}): FormGroup {
    const {
      name = '',
      weight = 0,
      type = 'FLOUR',
      costPerUnit = 0,
      bulkPrice = 0,
      bulkWeight = 0,
      nutrition = null,
      // An ingredient with no saved amount/unit is a legacy (pre-unit-picker)
      // row -- backfill amount from weight and assume grams, so it renders
      // and behaves exactly as it always has.
      amount = weight,
      unit = 'g',
      gramsPerCup = null,
      gramsPerItem = null
    } = opts;

    return this.fb.group({
      name: [name],
      weight: [weight],
      type: [type],
      costPerUnit: [costPerUnit],
      bulkPrice: [bulkPrice],
      bulkWeight: [bulkWeight],
      // Nutrition travels with the ingredient so re-saving a recipe never
      // wipes values that were looked up or backfilled earlier.
      nutrition: [nutrition],
      // What she actually typed -- weight above is always the canonical
      // grams value derived from these; see syncWeightFromAmount.
      amount: [amount],
      unit: [unit as MeasureUnit],
      gramsPerCup: [gramsPerCup],
      gramsPerItem: [gramsPerItem]
    });
  }

  get packOptions(): FormArray {
    return this.recipeForm.get('packOptions') as FormArray;
  }

  createPackOption(label = '', size = 1, price = 0): FormGroup {
    return this.fb.group({
      label: [label],
      size: [size, [Validators.required, Validators.min(1)]],
      price: [price, [Validators.required, Validators.min(0)]]
    });
  }

  addPackOption(): void {
    this.packOptions.push(this.createPackOption());
    this.updateCalculations();
  }

  removePackOption(index: number): void {
    this.packOptions.removeAt(index);
    this.updateCalculations();
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
      sku: formValue.sku,
      barcode: formValue.barcode,
      productType: formValue.productType,
      prepTimeMinutes: formValue.prepTimeMinutes,
      bakeTimeMinutes: formValue.bakeTimeMinutes,
      ingredients: formValue.ingredients.map((ing: any) => ({
        ...ing,
        bulkPrice: ing.bulkPrice,
        bulkWeight: ing.bulkWeight,
        // Recipe's own saved nutrition wins (never overwritten retroactively);
        // then the pantry (this is what survives a page reload); then the
        // in-memory local DB; calculateBakersMath itself falls further back
        // to MOCK_INGREDIENTS_DB, then zeros.
        nutrition: ing.nutrition || this.pantryService.nutritionFor(ing.name) || this.ingredientService.getNutrition(ing.name)
      })),
      levainDetails: {
        hydration: formValue.levainHydration / 100
      },
      servingSizeGrams: formValue.servingSizeGrams,
      itemWeightGrams: Number(formValue.itemWeightGrams) > 0 ? Number(formValue.itemWeightGrams) : undefined,
      packOptions: (formValue.packOptions || [])
        .filter((opt: any) => Number(opt.size) > 0)
        .map((opt: any): PackOption => {
          const size = Number(opt.size);
          return {
            id: size === 1 ? 'single' : `${size}-pack`,
            label: (opt.label || '').trim() || (size === 1 ? 'Single' : `${size} Pack`),
            size,
            price: Number(opt.price) || 0
          };
        })
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
