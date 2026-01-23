import { IngredientService } from '../services/ingredient.service';
import { inject } from '@angular/core';

export type IngredientType = 'FLOUR' | 'WATER' | 'SALT' | 'LEVAIN' | 'INCLUSION';

export interface NutritionData {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

export interface Ingredient {
  name: string;
  weight: number;
  type: IngredientType;
  nutrition?: NutritionData;
  costPerUnit?: number; // Legacy/Fallback Cost per 100g
  bulkPrice?: number;   // What you paid for the whole pack
  bulkWeight?: number;  // How much the pack weighs (in grams)
}

export type RecipeCategory = 'BREAD' | 'PASTRY' | 'COOKIE' | 'BAGEL' | 'MUFFIN' | 'SPECIAL' | 'OTHER';
export type FlavorProfile = 'SWEET' | 'SAVORY' | 'PLAIN';

export interface Review {
  id: string;
  recipeId: string;
  customerId: string;
  customerName: string;
  rating: number; // 1-5
  comment: string;
  reply?: string;
  date: string;
}

export interface Recipe {
  id?: string;
  name: string;
  category: RecipeCategory;
  flavorProfile?: FlavorProfile;
  description?: string;
  price: number;
  imageUrl?: string;
  images?: string[];
  ingredients: Ingredient[];
  servingSizeGrams?: number;
  levainDetails?: {
    hydration: number; // e.g., 1.0 for 100%
  };
  instructions?: string;
  ratings?: Review[];
  averageRating?: number;
  isHidden?: boolean;
}

export interface CalculatedRecipe extends Recipe {
  totalFlour: number;
  totalWater: number;
  trueHydration: number;
  ingredients: (Ingredient & { percentage: number })[];
  totalNutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  nutritionPerServing?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  totalCost: number;
  profitMargin: number;
}

export const MOCK_INGREDIENTS_DB: Record<string, NutritionData> = {
  'Bread Flour': { caloriesPer100g: 364, proteinPer100g: 12, carbsPer100g: 76, fatPer100g: 1.5 },
  'Water': { caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  'Starter': { caloriesPer100g: 364, proteinPer100g: 12, carbsPer100g: 76, fatPer100g: 1.5 },
  'Salt': { caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  'Whole Wheat Flour': { caloriesPer100g: 339, proteinPer100g: 13, carbsPer100g: 72, fatPer100g: 2.5 },
  'Honey': { caloriesPer100g: 304, proteinPer100g: 0.3, carbsPer100g: 82, fatPer100g: 0 },
  'Cheddar Cheese': { caloriesPer100g: 403, proteinPer100g: 25, carbsPer100g: 1.3, fatPer100g: 33 },
  'Parmesan': { caloriesPer100g: 431, proteinPer100g: 38, carbsPer100g: 4.1, fatPer100g: 29 },
  'Olive Oil': { caloriesPer100g: 884, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
  'Walnuts': { caloriesPer100g: 654, proteinPer100g: 15, carbsPer100g: 14, fatPer100g: 65 },
  'Rye Flour': { caloriesPer100g: 338, proteinPer100g: 10, carbsPer100g: 75, fatPer100g: 1.6 },
  'Butter': { caloriesPer100g: 717, proteinPer100g: 0.9, carbsPer100g: 0.1, fatPer100g: 81 },
  'Sugar': { caloriesPer100g: 387, proteinPer100g: 0, carbsPer100g: 100, fatPer100g: 0 },
  'Brown Sugar': { caloriesPer100g: 380, proteinPer100g: 0, carbsPer100g: 98, fatPer100g: 0 },
  'Egg': { caloriesPer100g: 155, proteinPer100g: 13, carbsPer100g: 1.1, fatPer100g: 11 },
  'Milk': { caloriesPer100g: 42, proteinPer100g: 3.4, carbsPer100g: 5, fatPer100g: 1 },
  'Cinnamon': { caloriesPer100g: 247, proteinPer100g: 4, carbsPer100g: 81, fatPer100g: 1.2 },
  'Chocolate Chips': { caloriesPer100g: 478, proteinPer100g: 4, carbsPer100g: 65, fatPer100g: 23 },
  'Yeast': { caloriesPer100g: 325, proteinPer100g: 40, carbsPer100g: 41, fatPer100g: 8 },
};

/**
 * Calculates Baker's Percentages, True Hydration, and Nutrition.
 * Baker's Percentage = (Ingredient Weight / Total Flour Weight) * 100
 * Total Flour Weight includes Flour in Levain.
 * Total Water Weight includes Water in Levain.
 */
export function calculateBakersMath(recipe: Recipe): CalculatedRecipe {
  let recipeFlour = 0;
  let recipeWater = 0;
  let levainWeight = 0;

  recipe.ingredients.forEach((ing: Ingredient) => {
    if (ing.type === 'FLOUR') recipeFlour += ing.weight;
    if (ing.type === 'WATER') recipeWater += ing.weight;
    if (ing.type === 'LEVAIN') levainWeight += ing.weight;
  });

  const levainHydration = recipe.levainDetails?.hydration ?? 0.75; // Default 75%

  // Levain = Flour + Water
  // Water = Flour * Hydration
  // Levain = Flour + Flour * Hydration = Flour * (1 + Hydration)
  // Flour in Levain = Levain / (1 + Hydration)
  const flourInLevain = levainWeight / (1 + levainHydration);
  const waterInLevain = levainWeight - flourInLevain;

  const totalFlour = recipeFlour + flourInLevain;
  const totalWater = recipeWater + waterInLevain;
  const trueHydration = totalFlour > 0 ? totalWater / totalFlour : 0;

  const calculatedIngredients = recipe.ingredients.map((ing: Ingredient) => ({
    ...ing,
    percentage: totalFlour > 0 ? (ing.weight / totalFlour) * 100 : 0
  }));

  const totalNutrition = recipe.ingredients.reduce(
    (acc, ing: Ingredient) => {
      // In a real app, we might use the service here, but for now we'll check our mock DB
      // We pass the DB reference from the caller or keep it simple here.
      // Since this is a pure function, let's just make it handle nutrition if provided.
      const dbEntry = ing.nutrition || MOCK_INGREDIENTS_DB[ing.name] || {
        caloriesPer100g: 0,
        proteinPer100g: 0,
        carbsPer100g: 0,
        fatPer100g: 0,
      };
      acc.calories += (ing.weight / 100) * dbEntry.caloriesPer100g;
      acc.protein += (ing.weight / 100) * dbEntry.proteinPer100g;
      acc.carbs += (ing.weight / 100) * dbEntry.carbsPer100g;
      acc.fat += (ing.weight / 100) * dbEntry.fatPer100g;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const totalCost = recipe.ingredients.reduce((acc, ing) => {
    let ingCost = 0;
    if (ing.bulkPrice && ing.bulkWeight && ing.bulkWeight > 0) {
      // (Bulk Price / Bulk Weight) * weight in recipe
      ingCost = (ing.bulkPrice / ing.bulkWeight) * ing.weight;
    } else {
      // Fallback to legacy costPerUnit (cost per 100g)
      ingCost = (ing.weight / 100) * (ing.costPerUnit || 0);
    }
    return acc + ingCost;
  }, 0);

  const profitMargin = recipe.price > 0 ? ((recipe.price - totalCost) / recipe.price) * 100 : 0;

  const totalWeight = recipe.ingredients.reduce((acc, ing) => acc + ing.weight, 0);
  let nutritionPerServing;

  if (recipe.servingSizeGrams && recipe.servingSizeGrams > 0 && totalWeight > 0) {
    const servings = totalWeight / recipe.servingSizeGrams;
    nutritionPerServing = {
      calories: totalNutrition.calories / servings,
      protein: totalNutrition.protein / servings,
      carbs: totalNutrition.carbs / servings,
      fat: totalNutrition.fat / servings,
    };
  }

  return {
    ...recipe,
    totalFlour,
    totalWater,
    trueHydration,
    ingredients: calculatedIngredients,
    totalNutrition,
    nutritionPerServing,
    totalCost,
    profitMargin
  };
}

/**
 * Scales a recipe to a target number of units based on a reference unit weight.
 */
export function scaleRecipe(recipe: Recipe, currentUnits: number, targetUnits: number): Recipe {
  const factor = targetUnits / currentUnits;
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ing: Ingredient) => ({
      ...ing,
      weight: ing.weight * factor
    }))
  };
}

export interface OrderItem {
  recipeId: string;
  name: string;
  quantity: number;
  weightGrams: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  type: 'PICKUP' | 'SHIPPING';
  status: 'PENDING' | 'READY' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';
  pickupDate?: string; // ISO date string
  shippingAddress?: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  trackingNumber?: string;
  items: OrderItem[];
  notes?: string;
  totalPrice: number;
  promoCode?: string;
  discountApplied?: number;
  shippingCost: number;
  paymentMethod?: {
    brand: string;
    last4: string;
  };
  createdAt: string;
}

export interface PromoCode {
  id?: string;
  code: string;
  type: 'FIXED' | 'PERCENT' | 'FREE_LOAF';
  value: number;
  minOrderValue?: number;
  description: string;
  isActive?: boolean;
  usageCount?: number;
}

/**
 * Aggregates orders for a specific bake date.
 */
export function aggregateOrders(orders: Order[], bakeDate: string) {
  return orders
    .filter(o => {
      const orderDate = o.pickupDate ? o.pickupDate.split('T')[0] : (o.createdAt ? o.createdAt.split('T')[0] : null);
      // Strip any potential time part from orderDate if it came from ISO string
      const normalizedOrderDate = orderDate ? orderDate.split(' ')[0] : null;
      return normalizedOrderDate === bakeDate && (o.status === 'PENDING' || o.status === 'READY' || o.status === 'SHIPPED');
    })
    .reduce((acc: Record<string, number>, order) => {
      order.items.forEach(item => {
        acc[item.name] = (acc[item.name] || 0) + item.quantity;
      });
      return acc;
    }, {});
}

/**
 * Calculates the total ingredients needed for a set of aggregated orders.
 */
export function calculateMasterDough(aggregatedOrders: Record<string, number>, recipes: Recipe[]) {
  const masterIngredients: Record<string, { weight: number, type: IngredientType }> = {};

  Object.entries(aggregatedOrders).forEach(([recipeName, quantity]) => {
    const recipe = recipes.find(r => r.name === recipeName);
    if (recipe) {
      recipe.ingredients.forEach(ing => {
        if (!masterIngredients[ing.name]) {
          masterIngredients[ing.name] = { weight: 0, type: ing.type };
        }
        masterIngredients[ing.name].weight += ing.weight * quantity;
      });
    }
  });

  return masterIngredients;
}
