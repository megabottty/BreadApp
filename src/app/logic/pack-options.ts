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
 * Pack options a customer can choose for a product: exactly the ones the
 * baker saved on it in the calculator. An empty list means "sold singly at
 * `price`".
 *
 * This used to fall back to a hard-coded price table by category (bagels,
 * cookies) and by name ("cinnamon roll"), which silently overrode the
 * baker's own price -- a $6 Cinnamon Roll and a $20 Cinnamon Rolls 4 Pack
 * both showed and charged "from $5". Per-product pack options are editable
 * in the recipe calculator now, so there is no reason to guess.
 */
export function resolvePackOptions(product: PackOptionsProduct): PackOption[] {
  return product.packOptions && product.packOptions.length > 0 ? product.packOptions : [];
}

/** Lowest price a customer can pay for this product (cheapest pack, or base price). */
export function getStartingPrice(product: PackOptionsProduct): { price: number; isFrom: boolean } {
  const packs = resolvePackOptions(product);
  if (packs.length === 0) {
    return { price: product.price ?? 0, isFrom: false };
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
