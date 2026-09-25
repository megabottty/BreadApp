
export type IngredientType = 'FLOUR' | 'WATER' | 'SALT' | 'LEVAIN' | 'INCLUSION';

export interface NutritionData {
  caloriesPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

export interface Ingredient {
  name: string;
  /** Canonical grams — always authoritative. `amount`/`unit` below are what
   * she typed and never feed the math directly; see `logic/units.ts`. */
  weight: number;
  type: IngredientType;
  nutrition?: NutritionData;
  costPerUnit?: number; // Legacy/Fallback Cost per 100g
  bulkPrice?: number;   // What you paid for the whole pack
  bulkWeight?: number;  // How much the pack weighs (in grams)
  /** What she typed, in `unit` — display/round-trip only. Optional so
   * existing saved recipes (which only ever had `weight`) parse unchanged. */
  amount?: number;
  /** Bare string union rather than importing `MeasureUnit` from
   * `logic/units.ts` — this file must never depend on the unit-conversion
   * module, so the storefront/server/ledger that read `weight` directly
   * never need to know a unit picker exists. Keep in sync with
   * `logic/units.ts`'s `MeasureUnit`. */
  unit?: 'g' | 'kg' | 'oz' | 'lb' | 'cup' | 'tbsp' | 'tsp' | 'each';
  /** Density/per-item conversion snapshot used to compute `weight` from
   * `amount` at entry time, so reopening a saved recipe reproduces the same
   * grams even if the pantry's density is corrected later. */
  gramsPerCup?: number;
  gramsPerItem?: number;
}

/** How an ingredient's per-gram cost was determined. */
export type CostBasis = 'PACK' | 'LEGACY' | 'FREE' | 'MISSING';

export type CostWarningCode = 'HIGH_UNIT_COST' | 'COST_OUTLIER' | 'LIKELY_PACK_SIZE_TYPO';

export interface CostWarning {
  code: CostWarningCode;
  ingredientName: string;
  costPerGram: number;
  message: string;
}

/** Per-recipe rollup of what's priced, what isn't, and anything that looks like a typo. */
export interface CostBreakdown {
  totalCost: number;
  /** Names of ingredients with no price at all — cost is understated by an unknown amount. */
  unpricedIngredientNames: string[];
  /** Fraction (0-1) of total batch weight that has a real price behind it. */
  costCoverageRatio: number;
  isComplete: boolean;
  warnings: CostWarning[];
}

export type RecipeCategory = 'BREAD' | 'PASTRY' | 'COOKIE' | 'BAGEL' | 'MUFFIN' | 'SCONE' | 'SPECIAL' | 'OTHER';
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

/** A purchasable bundle of a product, e.g. "6 Cookies" for $10. `price` is the
 * total for the whole pack (it replaces the base product price). */
export interface PackOption {
  id: string;
  label: string;
  size: number;
  price: number;
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
  available_addons?: { name: string; price: number }[];
  sku?: string;
  barcode?: string;
  productType?: 'PHYSICAL' | 'SERVICE' | 'DIGITAL';
  servingSizeGrams?: number;
  /** Finished (baked) weight of the one item this recipe makes — one loaf,
   * one monkey bread, one pack of rolls. The recipe as entered is one item. */
  itemWeightGrams?: number;
  /** Per-product pack pricing. Empty/undefined = sold singly at `price`. */
  packOptions?: PackOption[];
  levainDetails?: {
    hydration: number; // e.g., 1.0 for 100%
  };
  instructions?: string;
  ratings?: Review[];
  averageRating?: number;
  isHidden?: boolean;
  prepTimeMinutes?: number;
  bakeTimeMinutes?: number;
}

export interface CalculatedRecipe extends Recipe {
  totalFlour: number;
  totalWater: number;
  trueHydration: number;
  ingredients: (Ingredient & { percentage: number; cost: number; costPerGram: number; costBasis: CostBasis })[];
  /** Sum of all ingredient weights (grams) for the whole recipe/batch as entered. */
  totalWeightGrams: number;
  totalNutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  /** Nutrition per gram of the recipe — the reliable basis for any per-serving
   * or "grams eaten" calculation, since it doesn't depend on knowing how many
   * servings/items the batch yields. */
  nutritionPerGram: {
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
  /** Nutrition for the one whole item this recipe makes (= the batch totals),
   * present when `itemWeightGrams` is known. */
  nutritionPerItem?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  /** Nutrition per gram of the *baked* item (batch totals ÷ finished weight).
   * More accurate than `nutritionPerGram` for "grams eaten", since dough
   * loses water in the oven. */
  nutritionPerBakedGram?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  totalCost: number;
  profitMargin: number;
  /** The recipe as entered makes one item (see `itemWeightGrams` above), so
   * this equals `totalCost` — named for clarity when showing per-item cost. */
  costPerItem: number;
  costBreakdown: CostBreakdown;
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

/** $1/g ≈ $454/lb — nothing a bakery buys by weight legitimately costs this
 * much, outside genuine specialty spices (saffron, vanilla beans...), which
 * is why this only ever produces a dismissible warning, never a block. */
export const SUSPICIOUS_COST_PER_GRAM = 1;

/**
 * Resolves one ingredient's per-gram cost and how confident we are in it.
 * The numeric result exactly matches the historical precedence — bulk pack
 * basis when `bulkWeight > 0`, else the legacy per-100g fallback, else 0 —
 * this only adds a label for the cost-visibility UI.
 */
export function resolveIngredientCostPerGram(ing: Ingredient): { costPerGram: number; costBasis: CostBasis } {
  const bulkWeightGrams = Number(ing.bulkWeight);
  if (ing.bulkPrice && ing.bulkWeight && bulkWeightGrams > 0) {
    return { costPerGram: Number(ing.bulkPrice) / bulkWeightGrams, costBasis: 'PACK' };
  }

  const legacyCostPerUnit = ing.costPerUnit === undefined || ing.costPerUnit === null ? NaN : Number(ing.costPerUnit);
  if (!Number.isNaN(legacyCostPerUnit)) {
    return { costPerGram: legacyCostPerUnit / 100, costBasis: legacyCostPerUnit > 0 ? 'LEGACY' : 'FREE' };
  }

  // Tap water has no realistic price to enter; treat it as free rather than
  // "missing a price" so the missing-price warning stays meaningful.
  if (ing.type === 'WATER') {
    return { costPerGram: 0, costBasis: 'FREE' };
  }

  return { costPerGram: 0, costBasis: 'MISSING' };
}

/** Weighted median (by cost contribution) used to flag an outlier ingredient
 * cost without a fixed dollar threshold — a $2/g spice is fine on its own,
 * but not when it's 10x every other ingredient in the same recipe. */
function weightedMedianCostPerGram(entries: { costPerGram: number; weight: number }[]): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort((a, b) => a.costPerGram - b.costPerGram);
  const totalWeight = sorted.reduce((acc, entry) => acc + entry.weight, 0);
  if (totalWeight <= 0) return sorted[Math.floor(sorted.length / 2)].costPerGram;

  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= totalWeight / 2) return entry.costPerGram;
  }
  return sorted[sorted.length - 1].costPerGram;
}

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

  const costPerIngredient = recipe.ingredients.map((ing: Ingredient) => {
    const { costPerGram, costBasis } = resolveIngredientCostPerGram(ing);
    return { costPerGram, costBasis, cost: costPerGram * Number(ing.weight) };
  });

  const calculatedIngredients = recipe.ingredients.map((ing: Ingredient, index: number) => ({
    ...ing,
    percentage: totalFlour > 0 ? (ing.weight / totalFlour) * 100 : 0,
    cost: costPerIngredient[index].cost,
    costPerGram: costPerIngredient[index].costPerGram,
    costBasis: costPerIngredient[index].costBasis
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

  // Ensure price is a number
  const price = Number(recipe.price) || 0;

  const totalCost = costPerIngredient.reduce((acc, c) => acc + c.cost, 0);
  const profitMargin = price > 0 ? ((price - totalCost) / price) * 100 : 0;
  const costPerItem = totalCost;

  const totalWeight = recipe.ingredients.reduce((acc, ing) => acc + ing.weight, 0);

  const unpricedIngredientNames = calculatedIngredients
    .filter(ing => ing.costBasis === 'MISSING')
    .map(ing => ing.name);

  const pricedWeight = calculatedIngredients
    .filter(ing => ing.costBasis !== 'MISSING')
    .reduce((acc, ing) => acc + Number(ing.weight), 0);

  const costCoverageRatio = totalWeight > 0 ? pricedWeight / totalWeight : 1;

  // Weighted by grams used, not by dollar cost — weighting by cost would bias
  // the median toward the very outlier this is meant to detect.
  const pricedIngredientsForMedian = calculatedIngredients
    .filter(ing => ing.cost > 0)
    .map(ing => ({ costPerGram: ing.costPerGram, weight: Number(ing.weight) }));
  const medianCostPerGram = weightedMedianCostPerGram(pricedIngredientsForMedian);

  const costWarnings: CostWarning[] = [];
  calculatedIngredients.forEach(ing => {
    if (ing.costBasis === 'MISSING' || ing.costPerGram <= 0) return;

    const bulkWeightGrams = Number(ing.bulkWeight);
    const bulkPriceDollars = Number(ing.bulkPrice);
    // A package under 200g for more than $5 is far more likely to be a typo
    // (100g typed for 1000g) than a genuine tiny/pricey package.
    const looksLikePackSizeTypo = ing.costBasis === 'PACK'
      && bulkWeightGrams > 0 && bulkWeightGrams < 200
      && bulkPriceDollars > 5;

    if (looksLikePackSizeTypo) {
      costWarnings.push({
        code: 'LIKELY_PACK_SIZE_TYPO',
        ingredientName: ing.name,
        costPerGram: ing.costPerGram,
        message: `${ing.name} costs $${ing.costPerGram.toFixed(2)}/g from a ${bulkWeightGrams}g package — did you mean ${bulkWeightGrams * 10}g?`
      });
      return;
    }

    if (ing.costPerGram > SUSPICIOUS_COST_PER_GRAM) {
      costWarnings.push({
        code: 'HIGH_UNIT_COST',
        ingredientName: ing.name,
        costPerGram: ing.costPerGram,
        message: `${ing.name} costs $${ing.costPerGram.toFixed(2)}/g — double check the package price and weight.`
      });
      return;
    }

    if (medianCostPerGram > 0 && ing.costPerGram > medianCostPerGram * 10 && ing.cost > totalCost * 0.25) {
      costWarnings.push({
        code: 'COST_OUTLIER',
        ingredientName: ing.name,
        costPerGram: ing.costPerGram,
        message: `${ing.name} costs much more per gram than the rest of this recipe and makes up a big share of its cost — worth a second look.`
      });
    }
  });

  const costBreakdown: CostBreakdown = {
    totalCost,
    unpricedIngredientNames,
    costCoverageRatio,
    isComplete: unpricedIngredientNames.length === 0,
    warnings: costWarnings
  };

  // Nutrition per gram is the stable basis for both "per serving" display
  // and the customer-facing "how many grams did you eat?" calculator —
  // it doesn't require knowing how many servings/items a batch yields.
  const nutritionPerGram = totalWeight > 0
    ? {
      calories: totalNutrition.calories / totalWeight,
      protein: totalNutrition.protein / totalWeight,
      carbs: totalNutrition.carbs / totalWeight,
      fat: totalNutrition.fat / totalWeight,
    }
    : { calories: 0, protein: 0, carbs: 0, fat: 0 };

  const scaleNutrition = (grams: number) => ({
    calories: nutritionPerGram.calories * grams,
    protein: nutritionPerGram.protein * grams,
    carbs: nutritionPerGram.carbs * grams,
    fat: nutritionPerGram.fat * grams,
  });

  const nutritionPerServing = (recipe.servingSizeGrams && recipe.servingSizeGrams > 0 && totalWeight > 0)
    ? scaleNutrition(recipe.servingSizeGrams)
    : undefined;

  // The recipe as entered makes exactly one finished item, so the whole
  // batch's nutrition is that item's nutrition; per baked gram divides it by
  // the finished weight (dough loses ~10-25% as water while baking).
  const hasItemWeight = !!recipe.itemWeightGrams && recipe.itemWeightGrams > 0 && totalWeight > 0;
  const nutritionPerItem = hasItemWeight ? { ...totalNutrition } : undefined;
  const nutritionPerBakedGram = hasItemWeight
    ? {
      calories: totalNutrition.calories / recipe.itemWeightGrams!,
      protein: totalNutrition.protein / recipe.itemWeightGrams!,
      carbs: totalNutrition.carbs / recipe.itemWeightGrams!,
      fat: totalNutrition.fat / recipe.itemWeightGrams!,
    }
    : undefined;

  return {
    ...recipe,
    price,
    totalFlour,
    totalWater,
    trueHydration,
    ingredients: calculatedIngredients,
    totalWeightGrams: totalWeight,
    totalNutrition,
    nutritionPerGram,
    nutritionPerServing,
    nutritionPerItem,
    nutritionPerBakedGram,
    totalCost,
    profitMargin,
    costPerItem,
    costBreakdown
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
      weight: ing.weight * factor,
      // Scale what she typed too -- otherwise a scaled recipe would still
      // show "2 cups" next to a doubled/halved gram figure.
      amount: ing.amount !== undefined ? ing.amount * factor : ing.amount
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
  customerEmail?: string;
  notificationPreference?: 'SMS' | 'EMAIL' | 'BOTH' | 'NONE';
  type: 'PICKUP' | 'SHIPPING';
  orderSource?: 'ONLINE' | 'PHONE' | 'WALK_IN';
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
  tableNumber?: string;
  paymentStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  subtotal?: number; // Added for tax calculation
  taxAmount?: number; // Added for tax tracking
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
