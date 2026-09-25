/**
 * Unit conversion for ingredient amounts — grams, kilograms, ounces, pounds,
 * cups, tablespoons, teaspoons, and "each" (for eggs, bananas, etc).
 *
 * This module is deliberately never imported by `bakers-math.ts`.
 * `calculateBakersMath` stays a pure, grams-only function — the storefront
 * re-runs it on raw database rows and the server's supply-plan generator
 * reads `ingredient.weight` directly, so nothing past the conversion
 * boundary should need to know a unit picker exists. Conversion happens at
 * exactly two points instead: the recipe form (amount → `weight` grams) and
 * the pantry save (package amount → `bulk_weight` grams).
 */

export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'cup' | 'tbsp' | 'tsp';
export type CountUnit = 'each';
export type MeasureUnit = MassUnit | VolumeUnit | CountUnit;

export type MeasureSystem = 'MASS' | 'VOLUME' | 'COUNT';

export interface UnitDefinition {
  readonly unit: MeasureUnit;
  readonly label: string;
  readonly abbreviation: string;
  readonly system: MeasureSystem;
}

/** Everything needed to turn an entered amount into grams for one ingredient. */
export interface MeasureContext {
  /** Grams in one US cup of this ingredient. Required for volume units. */
  readonly gramsPerCup?: number;
  /** Grams in one of this item (1 large egg ≈ 50). Required for 'each'. */
  readonly gramsPerItem?: number;
  /** Used only to look up a generic fallback density when neither of the
   * above is known — never persisted, just a hint for `toGrams`. */
  readonly ingredientName?: string;
}

export type ConversionStatus =
  | 'OK'
  | 'INVALID_AMOUNT'
  | 'MISSING_DENSITY'      // a volume unit with no grams-per-cup known for this item
  | 'MISSING_ITEM_WEIGHT'; // 'each' with no grams-per-item known

export interface GramConversion {
  readonly grams: number;
  readonly status: ConversionStatus;
  /** True when a generic fallback density/item-weight was used rather than
   * a value specific to this ingredient — the UI shows a ⚠ for this. */
  readonly assumed: boolean;
  /** Inline hint text, e.g. "2 cups ≈ 254 g". Empty when status !== 'OK'. */
  readonly hint: string;
}

export const MEASURE_UNITS: readonly UnitDefinition[] = [
  { unit: 'g', label: 'grams', abbreviation: 'g', system: 'MASS' },
  { unit: 'kg', label: 'kilograms', abbreviation: 'kg', system: 'MASS' },
  { unit: 'oz', label: 'ounces', abbreviation: 'oz', system: 'MASS' },
  { unit: 'lb', label: 'pounds', abbreviation: 'lb', system: 'MASS' },
  { unit: 'cup', label: 'cups', abbreviation: 'cup', system: 'VOLUME' },
  { unit: 'tbsp', label: 'tablespoons', abbreviation: 'tbsp', system: 'VOLUME' },
  { unit: 'tsp', label: 'teaspoons', abbreviation: 'tsp', system: 'VOLUME' },
  { unit: 'each', label: 'each', abbreviation: 'ea', system: 'COUNT' }
];

const UNIT_SYSTEM: Readonly<Record<MeasureUnit, MeasureSystem>> = MEASURE_UNITS.reduce(
  (acc, def) => ({ ...acc, [def.unit]: def.system }),
  {} as Record<MeasureUnit, MeasureSystem>
);

// Exact unit definitions — g is the base unit.
const GRAMS_PER_MASS_UNIT: Readonly<Record<MassUnit, number>> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237
};

// A cup is the volume basis; tbsp/tsp are simple fractions of it (16 tbsp
// and 48 tsp per US cup), so one density number per ingredient covers all
// three volume units.
const CUP_FRACTION: Readonly<Record<VolumeUnit, number>> = {
  cup: 1,
  tbsp: 1 / 16,
  tsp: 1 / 48
};

/**
 * Generic grams-per-cup for common baking staples, used only when neither
 * the ingredient's own pantry entry nor the caller supplies a density.
 * Matching is substring-based against a normalized name (see
 * `lookupDefaultDensity`), so "King Arthur Bread Flour" resolves via
 * "bread flour". Always surfaced as `assumed: true` in the UI — never used
 * to silently overwrite a value the baker or the pantry already knows.
 */
export const DEFAULT_GRAMS_PER_CUP: Readonly<Record<string, number>> = {
  'bread flour': 127,
  'all purpose flour': 120,
  'all-purpose flour': 120,
  'whole wheat flour': 113,
  'rye flour': 102,
  'cake flour': 114,
  'flour': 120,
  'granulated sugar': 200,
  'brown sugar': 213,
  'powdered sugar': 113,
  'sugar': 200,
  'water': 236,
  'milk': 244,
  'butter': 227,
  'oil': 218,
  'olive oil': 218,
  'honey': 340,
  'maple syrup': 322,
  'molasses': 328,
  'cocoa': 85,
  'oats': 90,
  'rolled oats': 90,
  'cornmeal': 138,
  'table salt': 273,
  'kosher salt': 142,
  'salt': 273,
  'chocolate chips': 170,
  'raisins': 145,
  'walnuts': 117,
  'yogurt': 245,
  'sour cream': 227,
  'cream cheese': 232
};

/** Generic grams-per-item, used the same way as `DEFAULT_GRAMS_PER_CUP`. */
export const DEFAULT_GRAMS_PER_ITEM: Readonly<Record<string, number>> = {
  egg: 50,
  'egg yolk': 18,
  'egg white': 33,
  'stick of butter': 113,
  butter: 113,
  banana: 118,
  lemon: 58,
  apple: 182
};

/** Matches the server's `normalizeName` in server/utils/pantry.cjs — keep
 * both in sync so a pantry row saved by one resolves under the other. */
export function normalizeIngredientName(name: string): string {
  return String(name || '').trim().toLowerCase();
}

function lookupByContains(name: string, table: Readonly<Record<string, number>>): number | undefined {
  const normalized = normalizeIngredientName(name)
    .replace(/[.,()]/g, ' ')
    .replace(/\b(organic|unbleached|enriched|bleached)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return undefined;

  // Longest key first, so "bread flour" wins over the bare "flour" fallback.
  const keys = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (normalized.includes(key)) return table[key];
  }
  return undefined;
}

export function lookupDefaultDensity(name: string): number | undefined {
  return lookupByContains(name, DEFAULT_GRAMS_PER_CUP);
}

export function lookupDefaultItemGrams(name: string): number | undefined {
  return lookupByContains(name, DEFAULT_GRAMS_PER_ITEM);
}

/** Used only when a volume/count unit has no density at all — assumed, not guessed to be zero. */
const FALLBACK_GRAMS_PER_CUP = 240;

function formatHint(grams: number): string {
  return `≈ ${Math.round(grams)} g`;
}

/**
 * Converts an entered amount + unit into grams.
 *
 * Mass units always resolve exactly, with no dependency on the ingredient.
 * Volume and count units need a density/item-weight — from `ctx` (typically
 * the pantry item's own value), else the generic default table, flagged
 * `assumed`. Never fabricates a density from nothing: if none is known at
 * all, this returns `grams: 0` with `MISSING_DENSITY`/`MISSING_ITEM_WEIGHT`
 * so the UI can ask once, rather than silently mis-costing the recipe.
 */
export function toGrams(amount: number, unit: MeasureUnit, ctx: MeasureContext = {}): GramConversion {
  if (!Number.isFinite(amount) || amount < 0) {
    return { grams: 0, status: 'INVALID_AMOUNT', assumed: false, hint: '' };
  }

  const system = UNIT_SYSTEM[unit];

  if (system === 'MASS') {
    const grams = amount * GRAMS_PER_MASS_UNIT[unit as MassUnit];
    return { grams, status: 'OK', assumed: false, hint: formatHint(grams) };
  }

  if (system === 'VOLUME') {
    const gramsPerCup = ctx.gramsPerCup
      ?? (ctx.ingredientName ? lookupDefaultDensity(ctx.ingredientName) : undefined);
    if (gramsPerCup === undefined) {
      // Still resolvable with the generic fallback so she's never blocked —
      // just always flagged as assumed.
      const grams = amount * CUP_FRACTION[unit as VolumeUnit] * FALLBACK_GRAMS_PER_CUP;
      return { grams, status: 'MISSING_DENSITY', assumed: true, hint: formatHint(grams) };
    }
    const assumed = ctx.gramsPerCup === undefined; // came from the default table, not her pantry
    const grams = amount * CUP_FRACTION[unit as VolumeUnit] * gramsPerCup;
    return { grams, status: 'OK', assumed, hint: formatHint(grams) };
  }

  // COUNT ('each')
  const gramsPerItem = ctx.gramsPerItem
    ?? (ctx.ingredientName ? lookupDefaultItemGrams(ctx.ingredientName) : undefined);
  if (gramsPerItem === undefined) {
    return { grams: 0, status: 'MISSING_ITEM_WEIGHT', assumed: true, hint: '' };
  }
  const assumed = ctx.gramsPerItem === undefined;
  const grams = amount * gramsPerItem;
  return { grams, status: 'OK', assumed, hint: formatHint(grams) };
}

/** Inverse of `toGrams` — used to redisplay a stored gram value in the unit
 * the baker last chose. Returns null when the unit can't be resolved
 * (volume/count with no density and no fallback requested by the caller). */
export function fromGrams(grams: number, unit: MeasureUnit, ctx: MeasureContext = {}): number | null {
  if (!Number.isFinite(grams) || grams < 0) return null;

  const system = UNIT_SYSTEM[unit];
  if (system === 'MASS') {
    return grams / GRAMS_PER_MASS_UNIT[unit as MassUnit];
  }
  if (system === 'VOLUME') {
    const gramsPerCup = ctx.gramsPerCup
      ?? (ctx.ingredientName ? lookupDefaultDensity(ctx.ingredientName) : undefined)
      ?? FALLBACK_GRAMS_PER_CUP;
    if (!gramsPerCup) return null;
    return grams / (CUP_FRACTION[unit as VolumeUnit] * gramsPerCup);
  }
  const gramsPerItem = ctx.gramsPerItem
    ?? (ctx.ingredientName ? lookupDefaultItemGrams(ctx.ingredientName) : undefined);
  if (!gramsPerItem) return null;
  return grams / gramsPerItem;
}

/** Parses a USDA Branded-food `packageWeight` string, e.g. "2 lb", "907 g",
 * "16 OZ". Returns null for anything it can't confidently parse — this
 * pre-fills the package-size field, so a wrong guess is worse than none. */
export function parsePackageWeight(raw: string | null | undefined): { amount: number; unit: MeasureUnit } | null {
  if (!raw) return null;
  const match = String(raw).trim().match(/^([\d.]+)\s*(g|kg|oz|lb|lbs|pound|pounds|ounce|ounces|gram|grams|kilogram|kilograms)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const rawUnit = match[2].toLowerCase();
  const unitMap: Record<string, MassUnit> = {
    g: 'g', gram: 'g', grams: 'g',
    kg: 'kg', kilogram: 'kg', kilograms: 'kg',
    oz: 'oz', ounce: 'oz', ounces: 'oz',
    lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb'
  };
  const unit = unitMap[rawUnit];
  if (!unit) return null;

  return { amount, unit };
}
