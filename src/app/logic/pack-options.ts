import { CalculatedRecipe, PackOption, RecipeCategory } from './bakers-math';

export interface PackOptionsProduct {
  name: string;
  category: RecipeCategory;
  price?: number;
  packOptions?: PackOption[];
}

/** How a single pack option performs against the recipe's actual cost. */
export interface PackEconomics {
  id: string;
  label: string;
  size: number;
  /** Total price for the whole pack. */
  price: number;
  /** Total cost for the whole pack (recipe cost-per-item × size). */
  cost: number;
  profit: number;
  /** Percent, same formula as `CalculatedRecipe.profitMargin`. */
  margin: number;
  pricePerItem: number;
  costPerItem: number;
}

/**
 * Pack options a customer can choose for a product. Per-product options saved
 * in the admin (recipe.packOptions) win; otherwise fall back to the bakery's
 * standard pricing by category. An empty list means "sold singly at price".
 */
export function resolvePackOptions(product: PackOptionsProduct): PackOption[] {
  if (product.packOptions && product.packOptions.length > 0) {
    return product.packOptions;
  }

  const name = (product.name || '').toLowerCase();

  if (product.category === 'BAGEL') {
    // Blueberry bagels are $2 more per pack than every other flavor.
    const surcharge = name.includes('blueberry') ? 2 : 0;
    return [
      { id: '4-pack', label: '4 Bagels', size: 4, price: 12 + surcharge },
      { id: '8-pack', label: '8 Bagels', size: 8, price: 20 + surcharge }
    ];
  }

  if (product.category === 'COOKIE') {
    return [
      { id: 'single', label: 'Single Cookie', size: 1, price: 3 },
      { id: '6-pack', label: '6 Cookies', size: 6, price: 10 },
      { id: '12-pack', label: '12 Cookies', size: 12, price: 20 }
    ];
  }

  if (name.includes('cinnamon roll')) {
    return [
      { id: 'single', label: 'Single Cinnamon Roll', size: 1, price: 5 },
      { id: '2-pack', label: '2 Cinnamon Rolls (Pack)', size: 2, price: 10 },
      { id: '4-pack', label: '4 Cinnamon Rolls (Pack)', size: 4, price: 18 }
    ];
  }

  return [];
}

/** Lowest price a customer can pay for this product (cheapest pack, or base price). */
export function getStartingPrice(product: PackOptionsProduct): { price: number; isFrom: boolean } {
  const packs = resolvePackOptions(product);
  if (packs.length === 0) {
    return { price: product.price || 12, isFrom: false };
  }
  return { price: Math.min(...packs.map(p => p.price)), isFrom: packs.length > 1 };
}

/**
 * Cost and margin for every pack option this recipe is actually sold under —
 * including the storefront's category-default packs when the recipe has no
 * explicit `packOptions` of its own (via `resolvePackOptions`), so margin
 * reflects what the customer is really charged, not just the batch price.
 */
export function calculatePackEconomics(recipe: CalculatedRecipe): PackEconomics[] {
  const packs = resolvePackOptions(recipe);
  return packs.map(pack => {
    const cost = recipe.costPerItem * pack.size;
    const profit = pack.price - cost;
    const margin = pack.price > 0 ? (profit / pack.price) * 100 : 0;
    return {
      id: pack.id,
      label: pack.label,
      size: pack.size,
      price: pack.price,
      cost,
      profit,
      margin,
      pricePerItem: pack.size > 0 ? pack.price / pack.size : 0,
      costPerItem: recipe.costPerItem
    };
  });
}
