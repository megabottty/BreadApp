import { Component, OnInit, signal, computed, inject, effect } from '@angular/core';
import { CommonModule, DecimalPipe, PercentPipe, KeyValuePipe } from '@angular/common';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { calculateBakersMath, Recipe, CalculatedRecipe, IngredientType, scaleRecipe, MOCK_INGREDIENTS_DB, Order, aggregateOrders, calculateMasterDough, RecipeCategory, FlavorProfile } from '../../logic/bakers-math';
import { NotificationService } from '../../services/notification.service';
import { AuthService } from '../../services/auth.service';
import { IngredientService, FoodSearchItem } from '../../services/ingredient.service';
import { SubscriptionService } from '../../services/subscription.service';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-recipe-calculator',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, DecimalPipe, PercentPipe, KeyValuePipe],
  templateUrl: './recipe-calculator.html',
  styleUrls: ['./recipe-calculator.css']
})
export class RecipeCalculatorComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ingredientService = inject(IngredientService);
  private subscriptionService = inject(SubscriptionService);

  recipeForm: FormGroup;
  ingredientTypes: IngredientType[] = ['FLOUR', 'WATER', 'LEVAIN', 'SALT', 'INCLUSION'];
  recipeCategories: RecipeCategory[] = ['BREAD', 'PASTRY', 'COOKIE', 'SPECIAL', 'OTHER'];
  flavorProfiles: FlavorProfile[] = ['SWEET', 'SAVORY', 'PLAIN'];
  knownIngredients = Object.keys(MOCK_INGREDIENTS_DB);

  searchResults = signal<FoodSearchItem[]>([]);
  activeSearchIndex = signal<number | null>(null);

  calculatedRecipe = signal<CalculatedRecipe | undefined>(undefined);
  savedRecipes = signal<CalculatedRecipe[]>([]);

  // Production Brain
  bakeDate = signal<string>(new Date().toISOString().split('T')[0]);
  mockOrders = signal<Order[]>([]);

  aggregatedOrders = computed(() => {
    return aggregateOrders(this.mockOrders(), this.bakeDate());
  });

  subscriptionOrders = computed(() => {
    // Treat all active subscriptions as orders for their nextBakeDate
    const subs = this.subscriptionService.allSubscriptions().filter(s =>
      s.status === 'ACTIVE' && s.nextBakeDate === this.bakeDate()
    );

    const agg: Record<string, number> = {};
    subs.forEach(s => {
      agg[s.recipeName] = (agg[s.recipeName] || 0) + s.quantity;
    });
    return agg;
  });

  masterDough = computed(() => {
    const ordersAgg = this.aggregatedOrders();
    const subsAgg = this.subscriptionOrders();

    // Merge aggregations
    const totalAgg = { ...ordersAgg };
    Object.entries(subsAgg).forEach(([name, qty]) => {
      totalAgg[name] = (totalAgg[name] || 0) + qty;
    });

    return calculateMasterDough(totalAgg, this.savedRecipes());
  });

  filteredOrders = computed(() => {
    return this.mockOrders().filter(o => o.pickupDate === this.bakeDate());
  });

  showNotifications = signal<boolean>(false);
  customWeight = signal<number>(100);

  customCalories = computed(() => {
    const recipe = this.calculatedRecipe();
    if (!recipe || recipe.totalNutrition.calories === 0) return 0;

    const totalWeight = recipe.ingredients.reduce((acc, ing) => acc + ing.weight, 0);
    if (totalWeight === 0) return 0;

    return (this.customWeight() / totalWeight) * recipe.totalNutrition.calories;
  });

  statusSummary = computed(() => {
    const orders = this.filteredOrders();
    return {
      pending: orders.filter(o => o.status === 'PENDING').length,
      ready: orders.filter(o => o.status === 'READY' || o.status === 'SHIPPED').length,
      completed: orders.filter(o => o.status === 'COMPLETED').length,
      total: orders.length
    };
  });

  constructor(private fb: FormBuilder, public notificationService: NotificationService) {
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
      currentUnits: [1],
      targetUnits: [1],
      ingredients: this.fb.array([
        this.createIngredient('Bread Flour', 500, 'FLOUR'),
        this.createIngredient('Water', 350, 'WATER'),
        this.createIngredient('Starter', 100, 'LEVAIN'),
        this.createIngredient('Salt', 10, 'SALT'),
      ])
    });
  }

  ngOnInit(): void {
    if (!this.authService.isBaker()) {
      this.router.navigate(['/store']);
      return;
    }
    this.loadSavedRecipes();
    this.loadMockOrders();

    // Check for ID in route
    const recipeId = this.route.snapshot.paramMap.get('id');
    if (recipeId) {
      const recipe = this.savedRecipes().find(r => r.id === recipeId);
      if (recipe) {
        this.loadRecipe(recipe);
      }
    }

    this.recipeForm.valueChanges.subscribe(() => {
      this.updateCalculations();
    });
    this.updateCalculations();
  }

  loadMockOrders(): void {
    const today = new Date().toISOString().split('T')[0];
    this.mockOrders.set([
      {
        id: '1',
        customerId: 'c1',
        customerName: 'Alice',
        customerPhone: '1234567890',
        type: 'PICKUP',
        status: 'PENDING',
        pickupDate: today,
        items: [{ recipeId: 'r1', name: 'Country Loaf', quantity: 5, weightGrams: 900 }],
        notes: 'Extra crispy crust please!',
        totalPrice: 60,
        shippingCost: 0,
        createdAt: today
      },
      {
        id: '2',
        customerId: 'c2',
        customerName: 'Bob',
        customerPhone: '0987654321',
        type: 'SHIPPING',
        status: 'PENDING',
        pickupDate: today,
        items: [{ recipeId: 'r1', name: 'Country Loaf', quantity: 2, weightGrams: 900 }],
        totalPrice: 24,
        shippingCost: 10,
        createdAt: today
      }
    ]);
  }

  onBakeDateChange(): void {
    // Computed signals handle the update
  }

  loadSavedRecipes(): void {
    const saved = localStorage.getItem('bakery_recipes');
    if (saved) {
      try {
        this.savedRecipes.set(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading recipes', e);
      }
    }
  }

  getRecipeCategory(recipeName: string): string {
    const recipe = this.savedRecipes().find(r => r.name === recipeName);
    return recipe?.category || 'BREAD';
  }

  saveRecipe(): void {
    const current = this.calculatedRecipe();
    if (current) {
      this.savedRecipes.update(prev => {
        const recipeToSave = { ...current };
        let updated: CalculatedRecipe[];

        if (recipeToSave.id) {
          // Update existing
          updated = prev.map(r => r.id === recipeToSave.id ? recipeToSave : r);
        } else {
          // Create new
          recipeToSave.id = Date.now().toString();
          updated = [...prev, recipeToSave];
          // Update form with new ID so subsequent saves update the same record
          this.recipeForm.patchValue({ id: recipeToSave.id }, { emitEvent: false });
        }

        localStorage.setItem('bakery_recipes', JSON.stringify(updated));
        return updated;
      });
      alert('Recipe saved successfully!');
    }
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
    this.recipeForm.patchValue({
      id: recipe.id,
      name: recipe.name,
      category: recipe.category,
      flavorProfile: recipe.flavorProfile || null,
      description: recipe.description || '',
      price: recipe.price || 12,
      imageUrl: recipe.imageUrl || '',
      levainHydration: (recipe.levainDetails?.hydration ?? 1) * 100,
      servingSizeGrams: recipe.servingSizeGrams || 50,
      currentUnits: 1,
      targetUnits: 1
    });

    const imagesArray = this.recipeForm.get('images') as FormArray;
    imagesArray.clear();
    if (recipe.images) {
      recipe.images.forEach(img => imagesArray.push(this.fb.control(img)));
    } else if (recipe.imageUrl) {
      imagesArray.push(this.fb.control(recipe.imageUrl));
    }

    const ingredientsArray = this.recipeForm.get('ingredients') as FormArray;
    ingredientsArray.clear();
    recipe.ingredients.forEach(ing => {
      ingredientsArray.push(this.createIngredient(ing.name, ing.weight, ing.type));
    });
    this.updateCalculations();
  }

  deleteRecipe(id: string | undefined): void {
    if (!id) return;
    const updated = this.savedRecipes().filter(r => r.id !== id);
    this.savedRecipes.set(updated);
    localStorage.setItem('bakery_recipes', JSON.stringify(updated));
  }

  get ingredients(): FormArray {
    return this.recipeForm.get('ingredients') as FormArray;
  }

  onSearch(event: Event, index: number) {
    const term = (event.target as HTMLInputElement).value;
    this.activeSearchIndex.set(index);
    if (term.length >= 2) {
      this.searchResults.set(this.ingredientService.search(term));
    } else {
      this.searchResults.set([]);
    }
  }

  selectIngredient(item: FoodSearchItem, index: number) {
    const ingredientForm = this.ingredients.at(index) as FormGroup;
    ingredientForm.patchValue({ name: item.name });
    this.searchResults.set([]);
    this.activeSearchIndex.set(null);
    this.updateCalculations();
  }

  createIngredient(name = '', weight = 0, type: IngredientType = 'FLOUR'): FormGroup {
    return this.fb.group({
      name: [name],
      weight: [weight],
      type: [type]
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
      ingredients: formValue.ingredients.map((ing: any) => ({
        ...ing,
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

  updateOrderStatus(orderId: string, status: Order['status']): void {
    this.mockOrders.update(prev => prev.map(o => {
      if (o.id === orderId) {
        const updated = { ...o, status };
        this.triggerNotification(updated);
        return updated;
      }
      return o;
    }));
  }

  private triggerNotification(order: Order): void {
    if (order.status === 'READY' && order.type === 'PICKUP') {
      this.notificationService.sendReadyForPickup(order.customerName, order.customerPhone);
    } else if (order.status === 'SHIPPED' && order.type === 'SHIPPING') {
      this.notificationService.sendOutForDelivery(order.customerName, order.customerPhone, 'https://daily-dough.com/track/' + order.id);
    }
  }
}
