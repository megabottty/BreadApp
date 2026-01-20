import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NutritionData, MOCK_INGREDIENTS_DB } from '../logic/bakers-math';
import { map, Observable, of, catchError } from 'rxjs';

export interface FoodSearchItem {
  name: string;
  nutrition: NutritionData;
}

@Injectable({
  providedIn: 'root'
})
export class IngredientService {
  private http = inject(HttpClient);

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

  // Use a public API (USDA FoodData Central)
  // For demo, we search both our local DB and the API.
  search(term: string): Observable<FoodSearchItem[]> {
    if (!term || term.trim().length < 2) return of([]);

    const normalizedTerm = term.toLowerCase().trim();
    const localResults = Object.keys(this.ingredientsDb())
      .filter(name => name.toLowerCase().includes(normalizedTerm))
      .map(name => ({ name, nutrition: this.ingredientsDb()[name] }));

    // USDA FoodData Central Search API (using demo key)
    const apiKey = 'DEMO_KEY';
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(normalizedTerm)}&pageSize=10&api_key=${apiKey}`;

    return this.http.get<any>(url).pipe(
      map(response => {
        const apiResults = (response.foods || []).map((food: any) => {
          // Map USDA nutrients to our NutritionData format
          const getNutrient = (id: number) => {
            const n = food.foodNutrients.find((nut: any) => nut.nutrientId === id);
            return n ? n.value : 0;
          };

          return {
            name: food.description,
            nutrition: {
              caloriesPer100g: getNutrient(1008), // Energy
              proteinPer100g: getNutrient(1003),  // Protein
              carbsPer100g: getNutrient(1005),    // Carbohydrate
              fatPer100g: getNutrient(1004)       // Total lipid (fat)
            }
          };
        });

        // Combine and de-duplicate (prefer local for common items)
        const combined = [...localResults];
        apiResults.forEach((apiItem: any) => {
          // Avoid adding items that are already in local results or duplicates from API
          const isDuplicate = combined.some(c => c.name.toLowerCase() === apiItem.name.toLowerCase());
          if (!isDuplicate) {
            combined.push(apiItem);
          }
        });

        return combined.slice(0, 15);
      }),
      catchError(err => {
        console.error('API search failed, falling back to local results', err);
        return of(localResults);
      })
    );
  }

  getNutrition(name: string): NutritionData | undefined {
    return this.ingredientsDb()[name];
  }

  addIngredient(name: string, nutrition: NutritionData) {
    this.ingredientsDb.update(prev => ({ ...prev, [name]: nutrition }));
  }
}
