import { Injectable, signal } from '@angular/core';
import { NutritionData, MOCK_INGREDIENTS_DB } from '../logic/bakers-math';

export interface FoodSearchItem {
  name: string;
  nutrition: NutritionData;
}

@Injectable({
  providedIn: 'root'
})
export class IngredientService {
  private ingredientsDb = signal<Record<string, NutritionData>>({
    ...MOCK_INGREDIENTS_DB,
    'Milk Chocolate': { caloriesPer100g: 535, proteinPer100g: 7.7, carbsPer100g: 59, fatPer100g: 30 },
    'Dark Chocolate': { caloriesPer100g: 546, proteinPer100g: 4.9, carbsPer100g: 61, fatPer100g: 31 },
    'Almonds': { caloriesPer100g: 579, proteinPer100g: 21, carbsPer100g: 22, fatPer100g: 50 },
    'Blueberries': { caloriesPer100g: 57, proteinPer100g: 0.7, carbsPer100g: 14, fatPer100g: 0.3 },
    'Strawberries': { caloriesPer100g: 32, proteinPer100g: 0.7, carbsPer100g: 7.7, fatPer100g: 0.3 },
    'Raisins': { caloriesPer100g: 299, proteinPer100g: 3, carbsPer100g: 79, fatPer100g: 0.5 },
    'Oats': { caloriesPer100g: 389, proteinPer100g: 16.9, carbsPer100g: 66, fatPer100g: 6.9 },
    'Pumpkin Seeds': { caloriesPer100g: 559, proteinPer100g: 30, carbsPer100g: 11, fatPer100g: 49 },
    'Sunflower Seeds': { caloriesPer100g: 584, proteinPer100g: 21, carbsPer100g: 20, fatPer100g: 51 },
    'Cream Cheese': { caloriesPer100g: 342, proteinPer100g: 6, carbsPer100g: 4.1, fatPer100g: 34 },
    'Yogurt': { caloriesPer100g: 59, proteinPer100g: 10, carbsPer100g: 3.6, fatPer100g: 0.4 },
    'Coconut Oil': { caloriesPer100g: 862, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
    'Maple Syrup': { caloriesPer100g: 260, proteinPer100g: 0, carbsPer100g: 67, fatPer100g: 0.1 },
    'Molasses': { caloriesPer100g: 290, proteinPer100g: 0, carbsPer100g: 75, fatPer100g: 0.1 },
    'Sea Salt': { caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
    'Vanilla Extract': { caloriesPer100g: 288, proteinPer100g: 0, carbsPer100g: 13, fatPer100g: 0.1 },
    'Baking Powder': { caloriesPer100g: 53, proteinPer100g: 0, carbsPer100g: 28, fatPer100g: 0 },
    'Baking Soda': { caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 },
  });

  search(term: string): FoodSearchItem[] {
    if (!term || term.length < 2) return [];
    const db = this.ingredientsDb();
    const normalizedTerm = term.toLowerCase();
    return Object.keys(db)
      .filter(name => name.toLowerCase().includes(normalizedTerm))
      .map(name => ({ name, nutrition: db[name] }));
  }

  getNutrition(name: string): NutritionData | undefined {
    return this.ingredientsDb()[name];
  }

  addIngredient(name: string, nutrition: NutritionData) {
    this.ingredientsDb.update(prev => ({ ...prev, [name]: nutrition }));
  }
}
