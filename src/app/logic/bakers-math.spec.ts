import { describe, it, expect } from 'vitest';
import { calculateBakersMath, Recipe, scaleRecipe } from './bakers-math';

describe('Bakers Math Logic', () => {
  const sampleRecipe: Recipe = {
    name: 'Country Loaf',
    ingredients: [
      { name: 'Bread Flour', weight: 450, type: 'FLOUR' },
      { name: 'Water', weight: 300, type: 'WATER' },
      { name: 'Levain', weight: 100, type: 'LEVAIN' },
      { name: 'Salt', weight: 10, type: 'SALT' }
    ],
    levainDetails: { hydration: 1.0 } // 100% hydration levain
  };

  it('should calculate correct Total Flour and Total Water', () => {
    const result = calculateBakersMath(sampleRecipe);

    // 100g Levain at 100% hydration = 50g flour + 50g water
    // Total Flour = 450 (Bread Flour) + 50 (Levain) = 500
    // Total Water = 300 (Water) + 50 (Levain) = 350

    expect(result.totalFlour).toBe(500);
    expect(result.totalWater).toBe(350);
  });

  it('should calculate correct True Hydration', () => {
    const result = calculateBakersMath(sampleRecipe);
    // 350 / 500 = 0.7 (70%)
    expect(result.trueHydration).toBe(0.7);
  });

  it('should calculate correct Baker Percentages', () => {
    const result = calculateBakersMath(sampleRecipe);

    const flourIng = result.ingredients.find(i => i.name === 'Bread Flour');
    const saltIng = result.ingredients.find(i => i.name === 'Salt');

    // (450 / 500) * 100 = 90%
    expect(flourIng?.percentage).toBe(90);
    // (10 / 500) * 100 = 2%
    expect(saltIng?.percentage).toBe(2);
  });

  it('should scale recipes correctly', () => {
    const scaled = scaleRecipe(sampleRecipe, 1, 2); // Double the recipe

    const flourIng = scaled.ingredients.find(i => i.name === 'Bread Flour');
    const waterIng = scaled.ingredients.find(i => i.name === 'Water');

    expect(flourIng?.weight).toBe(900);
    expect(waterIng?.weight).toBe(600);
  });

  it('computes nutrition per gram from batch totals', () => {
    const result = calculateBakersMath(sampleRecipe);
    // Batch weight = 450 + 300 + 100 + 10 = 860g
    expect(result.totalWeightGrams).toBe(860);
    expect(result.nutritionPerGram.calories).toBeCloseTo(result.totalNutrition.calories / 860, 6);
    expect(result.nutritionPerItem).toBeUndefined();
  });

  it('treats the batch as one finished item when itemWeightGrams is set', () => {
    const result = calculateBakersMath({ ...sampleRecipe, itemWeightGrams: 710 });
    // Whole-item nutrition is the batch total; per baked gram divides by the finished weight
    expect(result.nutritionPerItem).toEqual(result.totalNutrition);
    expect(result.nutritionPerBakedGram!.calories).toBeCloseTo(result.totalNutrition.calories / 710, 6);
    // Baked grams are denser than dough grams, since water bakes off
    expect(result.nutritionPerBakedGram!.calories).toBeGreaterThan(result.nutritionPerGram.calories);
  });

  // Pinned BEFORE the pantry/cost-visibility work (see plan "Better ingredient
  // intake"). These document today's totalCost/profitMargin behavior exactly
  // as-is, so later additive changes can't silently change what the ledger,
  // analytics, and storefront already depend on.
  describe('cost and profit margin (pinned)', () => {
    it('costs an ingredient from bulkPrice/bulkWeight ($ per package / grams per package * weight used)', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 },
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN' },
          { name: 'Salt', weight: 10, type: 'SALT' }
        ]
      };
      const result = calculateBakersMath(recipe);
      // (15 / 5000) * 450 = 1.35
      expect(result.totalCost).toBeCloseTo(1.35, 6);
    });

    it('falls back to legacy costPerUnit (cost per 100g) when no bulk price/weight is set', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', costPerUnit: 0.15 },
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN' },
          { name: 'Salt', weight: 10, type: 'SALT' }
        ]
      };
      const result = calculateBakersMath(recipe);
      // (450 / 100) * 0.15 = 0.675
      expect(result.totalCost).toBeCloseTo(0.675, 6);
    });

    it('prefers the bulkPrice/bulkWeight basis over legacy costPerUnit when both are present', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000, costPerUnit: 999 },
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN' },
          { name: 'Salt', weight: 10, type: 'SALT' }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.totalCost).toBeCloseTo(1.35, 6);
    });

    it('does not divide by zero when bulkWeight is 0, and falls back to legacy costPerUnit', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 0, costPerUnit: 0.1 },
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN' },
          { name: 'Salt', weight: 10, type: 'SALT' }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(Number.isFinite(result.totalCost)).toBe(true);
      // (450 / 100) * 0.1 = 0.45
      expect(result.totalCost).toBeCloseTo(0.45, 6);
    });

    it('treats an ingredient with no price at all as $0 of cost', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR' }, // no bulkPrice, no costPerUnit
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN' },
          { name: 'Salt', weight: 10, type: 'SALT' }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.totalCost).toBe(0);
    });

    it('sums cost across every ingredient', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 }, // 1.35
          { name: 'Water', weight: 300, type: 'WATER' }, // 0
          { name: 'Levain', weight: 100, type: 'LEVAIN', costPerUnit: 0.2 }, // 0.2
          { name: 'Salt', weight: 10, type: 'SALT', bulkPrice: 2, bulkWeight: 1000 } // 0.02
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.totalCost).toBeCloseTo(1.35 + 0 + 0.2 + 0.02, 6);
    });

    it('computes profitMargin as (price - cost) / price * 100', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 } // cost 1.35
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.profitMargin).toBeCloseTo(((12 - 1.35) / 12) * 100, 6);
    });

    it('returns a 0 profitMargin when price is 0 or missing, instead of dividing by zero', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 0,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.profitMargin).toBe(0);
      expect(Number.isFinite(result.profitMargin)).toBe(true);
    });

    it('allows a negative profitMargin when cost exceeds price', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 1,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 } // cost 1.35
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.profitMargin).toBeLessThan(0);
    });

    it('coerces string-typed cost fields the same way it coerces string weights (defensive Number() wrapping)', () => {
      const recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: '450' as unknown as number, type: 'FLOUR', bulkPrice: '15' as unknown as number, bulkWeight: '5000' as unknown as number }
        ]
      } as Recipe;
      const result = calculateBakersMath(recipe);
      expect(result.totalCost).toBeCloseTo(1.35, 6);
    });
  });

  // New cost-visibility surface added on top of the pinned behaviour above.
  describe('cost visibility (per-ingredient cost, coverage, warnings)', () => {
    it('reports cost, costPerGram and costBasis per ingredient', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 },
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN', costPerUnit: 0.2 },
          { name: 'Salt', weight: 10, type: 'SALT' }
        ]
      };
      const result = calculateBakersMath(recipe);
      const flour = result.ingredients.find(i => i.name === 'Bread Flour')!;
      const water = result.ingredients.find(i => i.name === 'Water')!;
      const levain = result.ingredients.find(i => i.name === 'Levain')!;
      const salt = result.ingredients.find(i => i.name === 'Salt')!;

      expect(flour.costBasis).toBe('PACK');
      expect(flour.cost).toBeCloseTo(1.35, 6);
      expect(flour.costPerGram).toBeCloseTo(0.003, 6);

      expect(water.costBasis).toBe('FREE'); // unpriced WATER reads as free, not missing
      expect(water.cost).toBe(0);

      expect(levain.costBasis).toBe('LEGACY');
      expect(levain.cost).toBeCloseTo(0.2, 6);

      expect(salt.costBasis).toBe('MISSING'); // unpriced non-water ingredient
      expect(salt.cost).toBe(0);
    });

    it('lists unpriced ingredients and reports incomplete coverage without changing totalCost', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 }, // priced, 450g
          { name: 'Butter', weight: 50, type: 'INCLUSION' } // unpriced, 50g
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.costBreakdown.unpricedIngredientNames).toEqual(['Butter']);
      expect(result.costBreakdown.isComplete).toBe(false);
      // 450 priced / 500 total
      expect(result.costBreakdown.costCoverageRatio).toBeCloseTo(0.9, 6);
      expect(result.costBreakdown.totalCost).toBe(result.totalCost);
    });

    it('reports complete coverage when every ingredient has a price (or is legitimately free water)', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 },
          { name: 'Water', weight: 300, type: 'WATER' }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.costBreakdown.isComplete).toBe(true);
      expect(result.costBreakdown.unpricedIngredientNames).toEqual([]);
      expect(result.costBreakdown.costCoverageRatio).toBe(1);
    });

    it('flags an implausibly high per-gram cost (typo guard), distinct from the pack-size-typo heuristic', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          // $1.25/g from a 200g package — too big a package for the
          // pack-size-typo heuristic (which only fires under 200g), so this
          // exercises the plain absolute-threshold check.
          { name: 'Truffle Salt', weight: 10, type: 'SALT', bulkPrice: 250, bulkWeight: 200 }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.costBreakdown.warnings.some(w => w.code === 'HIGH_UNIT_COST' && w.ingredientName === 'Truffle Salt')).toBe(true);
    });

    it('flags a likely package-size typo (100g typed instead of 1000g) distinctly from a generic high-cost warning', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          // Flour bought for $15, but 100g was typed where 1000g was meant
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 100 }
        ]
      };
      const result = calculateBakersMath(recipe);
      const warning = result.costBreakdown.warnings.find(w => w.ingredientName === 'Bread Flour');
      expect(warning?.code).toBe('LIKELY_PACK_SIZE_TYPO');
    });

    it('flags a cost outlier relative to the rest of the recipe, not just an absolute threshold', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 100, type: 'FLOUR', bulkPrice: 1, bulkWeight: 1000 }, // $0.001/g, cost $0.1
          { name: 'Saffron', weight: 100, type: 'INCLUSION', bulkPrice: 5, bulkWeight: 100 } // $0.05/g — 50x flour, >25% of total cost
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.costBreakdown.warnings.some(w => w.code === 'COST_OUTLIER' && w.ingredientName === 'Saffron')).toBe(true);
    });

    it('does not warn on a normal recipe with unremarkable, consistent pricing', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 },
          { name: 'Water', weight: 300, type: 'WATER' },
          { name: 'Levain', weight: 100, type: 'LEVAIN', costPerUnit: 0.2 },
          { name: 'Salt', weight: 10, type: 'SALT', bulkPrice: 2, bulkWeight: 1000 }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.costBreakdown.warnings).toEqual([]);
    });

    it('sets costPerItem equal to totalCost, since the recipe as entered makes one item', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        price: 12,
        ingredients: [
          { name: 'Bread Flour', weight: 450, type: 'FLOUR', bulkPrice: 15, bulkWeight: 5000 }
        ]
      };
      const result = calculateBakersMath(recipe);
      expect(result.costPerItem).toBe(result.totalCost);
    });
  });

  describe('scaleRecipe (grams)', () => {
    it('scales every ingredient weight by the same factor', () => {
      const scaled = scaleRecipe(sampleRecipe, 2, 3); // 1.5x
      const flourIng = scaled.ingredients.find(i => i.name === 'Bread Flour');
      expect(flourIng?.weight).toBeCloseTo(450 * 1.5, 6);
    });

    it('scales the entered amount alongside weight, so a scaled recipe still shows the right "2 cups"-style figure', () => {
      const recipe: Recipe = {
        ...sampleRecipe,
        ingredients: [
          { name: 'Bread Flour', weight: 240, type: 'FLOUR', amount: 2, unit: 'cup', gramsPerCup: 120 },
          { name: 'Salt', weight: 10, type: 'SALT' } // no amount/unit -- legacy shape
        ]
      };
      const scaled = scaleRecipe(recipe, 1, 2); // double
      const flourIng = scaled.ingredients.find(i => i.name === 'Bread Flour');
      const saltIng = scaled.ingredients.find(i => i.name === 'Salt');

      expect(flourIng?.weight).toBeCloseTo(480, 6);
      expect(flourIng?.amount).toBeCloseTo(4, 6); // 2 cups -> 4 cups
      expect(flourIng?.unit).toBe('cup'); // unit itself never changes
      expect(saltIng?.amount).toBeUndefined(); // legacy ingredient with no amount stays that way
    });
  });
});
