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
});
