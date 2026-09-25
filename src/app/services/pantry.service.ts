import { Injectable, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, Subject, catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { CostBasis, IngredientType, NutritionData, resolveIngredientCostPerGram } from '../logic/bakers-math';
import { MeasureContext, MeasureUnit, normalizeIngredientName } from '../logic/units';
import { TenantService } from './tenant.service';
import { logger } from '../utils/logger';

export type NutritionSource = 'USDA' | 'LOCAL' | 'MANUAL';

/** The baker's pantry: one row per ingredient, reused across every recipe.
 * Backed by `bakery_ingredient_costs` — see server/utils/pantry.cjs. */
export interface PantryItem {
  id: number;
  name: string;
  normalizedName: string;
  bulkPrice: number | null;
  bulkWeight: number | null; // grams — canonical, matches Ingredient.bulkWeight
  costPerUnit: number | null; // legacy per-100g fallback
  packSize: number | null; // what she typed, in packUnit
  packUnit: MeasureUnit;
  defaultUseUnit: MeasureUnit;
  gramsPerCup: number | null;
  gramsPerItem: number | null;
  defaultType: IngredientType | null;
  nutrition: NutritionData | null;
  nutritionSource: NutritionSource | null;
  usdaFdcId: string | null;
  isArchived: boolean;
  costPerGram: number;
  costBasis: CostBasis;
  updatedAt: string | null;
}

/** Merge patch sent to `PUT /ingredients/pantry`. Only `name` is required —
 * every other field is optional and, when omitted, left untouched
 * server-side (see the select-then-write merge in server/utils/pantry.cjs). */
export interface PantryItemPatch {
  name: string;
  bulkPrice?: number | null;
  bulkWeight?: number | null;
  costPerUnit?: number | null;
  packSize?: number | null;
  packUnit?: MeasureUnit;
  defaultUseUnit?: MeasureUnit;
  gramsPerCup?: number | null;
  gramsPerItem?: number | null;
  defaultType?: IngredientType | null;
  nutrition?: NutritionData | null;
  nutritionSource?: NutritionSource;
  usdaFdcId?: string | null;
  isArchived?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PantryService {
  private readonly http = inject(HttpClient);
  private readonly tenantService = inject(TenantService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items = signal<readonly PantryItem[]>([]);
  readonly loaded = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);

  readonly byNormalizedName = computed<ReadonlyMap<string, PantryItem>>(() => {
    const map = new Map<string, PantryItem>();
    for (const item of this.items()) map.set(item.normalizedName, item);
    return map;
  });

  /** Ingredients with no price at all — drives the "Needs a price" filter
   * on the pantry screen. */
  readonly needsPrice = computed<readonly PantryItem[]>(() =>
    this.items().filter(item => item.costBasis === 'MISSING')
  );

  // One debounced save-stream per ingredient (keyed by normalized name), so
  // typing in two different rows' price popovers doesn't debounce against
  // each other, and rapid edits to the same ingredient coalesce into one
  // request instead of one per keystroke.
  private readonly saveSubjects = new Map<string, Subject<PantryItemPatch>>();

  private get headers(): HttpHeaders {
    const slug = this.tenantService.tenant()?.slug || 'thedailydough';
    return new HttpHeaders().set('x-tenant-slug', slug);
  }

  load(): void {
    this.isLoading.set(true);
    this.http.get<PantryItem[]>(`${environment.apiUrl}/orders/ingredients/pantry`, { headers: this.headers })
      .pipe(
        catchError(err => {
          logger.error('[PantryService] Failed to load pantry:', err);
          return of<PantryItem[]>([]);
        })
      )
      .subscribe(items => {
        this.items.set(items);
        this.loaded.set(true);
        this.isLoading.set(false);
      });
  }

  find(name: string): PantryItem | undefined {
    return this.byNormalizedName().get(normalizeIngredientName(name));
  }

  nutritionFor(name: string): NutritionData | undefined {
    return this.find(name)?.nutrition ?? undefined;
  }

  /** Density/per-item context for `toGrams`/`fromGrams` — prefers the
   * pantry's own value, falls back to the generic table via `ingredientName`
   * (see units.ts), never fabricates a value here. */
  conversionContextFor(name: string): MeasureContext {
    const item = this.find(name);
    return {
      gramsPerCup: item?.gramsPerCup ?? undefined,
      gramsPerItem: item?.gramsPerItem ?? undefined,
      ingredientName: name
    };
  }

  /** Immediate save — used by `queueSave`'s debounced pipeline, and
   * available directly for callers (e.g. the pantry screen) that want to
   * save on blur rather than debounce. */
  save(patch: PantryItemPatch): Observable<PantryItem> {
    return this.http.put<PantryItem>(`${environment.apiUrl}/orders/ingredients/pantry`, patch, { headers: this.headers })
      .pipe(tap(item => this.upsertLocal(item)));
  }

  /**
   * Debounced write-behind: updates the local signal immediately (so cost
   * recalculates on the keystroke) and saves to the server ~600ms after the
   * last call for this ingredient. This is what makes a price durable
   * without saving the whole recipe — replacing the old behavior where an
   * ingredient without both bulkPrice and bulkWeight was never persisted.
   */
  queueSave(patch: PantryItemPatch): void {
    const key = normalizeIngredientName(patch.name);
    if (!key) return;

    this.applyOptimistic(patch);

    let subject = this.saveSubjects.get(key);
    if (!subject) {
      subject = new Subject<PantryItemPatch>();
      subject.pipe(
        debounceTime(600),
        switchMap(pending => this.save(pending).pipe(
          catchError(err => {
            logger.error(`[PantryService] Failed to save pantry item "${pending.name}":`, err);
            return of(null);
          })
        )),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe();
      this.saveSubjects.set(key, subject);
    }
    subject.next(patch);
  }

  /** Soft-delete. Never a hard delete — a recipe that still name-matches
   * this ingredient would silently show it as free the next time it opens. */
  archive(id: number): Observable<void> {
    const item = this.items().find(i => i.id === id);
    return this.http.delete<{ archived: boolean }>(`${environment.apiUrl}/orders/ingredients/pantry/${id}`, { headers: this.headers })
      .pipe(
        tap(() => {
          if (item) this.items.update(prev => prev.filter(i => i.id !== id));
        }),
        switchMap(() => of(undefined))
      );
  }

  /** Recomputes `costPerGram`/`costBasis` from the current price fields —
   * needed after any optimistic local edit, since the server is the only
   * other place this gets computed (and won't have responded yet). Mirrors
   * `resolveIngredientCostPerGram`'s precedence exactly. */
  private withRecomputedCost(item: PantryItem): PantryItem {
    const { costPerGram, costBasis } = resolveIngredientCostPerGram({
      name: item.name,
      weight: 0,
      type: item.defaultType ?? 'INCLUSION',
      bulkPrice: item.bulkPrice ?? undefined,
      bulkWeight: item.bulkWeight ?? undefined,
      costPerUnit: item.costPerUnit ?? undefined
    });
    return { ...item, costPerGram, costBasis };
  }

  private upsertLocal(item: PantryItem): void {
    this.items.update(prev => {
      const index = prev.findIndex(i => i.normalizedName === item.normalizedName);
      if (index === -1) return [...prev, item];
      const next = [...prev];
      next[index] = item;
      return next;
    });
  }

  /** Merges a patch into the local signal ahead of the server round-trip.
   * Never clears fields the patch didn't mention — mirrors the server's
   * merge-by-provided-keys behavior so an optimistic price-only edit can't
   * blank out nutrition/density that's only known locally for a moment. */
  private applyOptimistic(patch: PantryItemPatch): void {
    const key = normalizeIngredientName(patch.name);
    const existing = this.byNormalizedName().get(key);

    if (!existing) {
      // Not in the pantry yet — show a provisional row immediately so the
      // recipe row's cost chip reflects it before the server confirms.
      const provisional: PantryItem = {
        id: -Date.now(), // negative/synthetic id, replaced once the real row comes back
        name: patch.name,
        normalizedName: key,
        bulkPrice: patch.bulkPrice ?? null,
        bulkWeight: patch.bulkWeight ?? null,
        costPerUnit: patch.costPerUnit ?? null,
        packSize: patch.packSize ?? null,
        packUnit: patch.packUnit ?? 'g',
        defaultUseUnit: patch.defaultUseUnit ?? 'g',
        gramsPerCup: patch.gramsPerCup ?? null,
        gramsPerItem: patch.gramsPerItem ?? null,
        defaultType: patch.defaultType ?? null,
        nutrition: patch.nutrition ?? null,
        nutritionSource: patch.nutritionSource ?? null,
        usdaFdcId: patch.usdaFdcId ?? null,
        isArchived: false,
        costPerGram: 0,
        costBasis: 'MISSING',
        updatedAt: null
      };
      this.items.update(prev => [...prev, this.withRecomputedCost(provisional)]);
      return;
    }

    const merged: PantryItem = { ...existing };
    if (patch.bulkPrice !== undefined) merged.bulkPrice = patch.bulkPrice;
    if (patch.bulkWeight !== undefined) merged.bulkWeight = patch.bulkWeight;
    if (patch.costPerUnit !== undefined) merged.costPerUnit = patch.costPerUnit;
    if (patch.packSize !== undefined) merged.packSize = patch.packSize;
    if (patch.packUnit !== undefined) merged.packUnit = patch.packUnit;
    if (patch.defaultUseUnit !== undefined) merged.defaultUseUnit = patch.defaultUseUnit;
    if (patch.gramsPerCup !== undefined) merged.gramsPerCup = patch.gramsPerCup;
    if (patch.gramsPerItem !== undefined) merged.gramsPerItem = patch.gramsPerItem;
    if (patch.defaultType !== undefined) merged.defaultType = patch.defaultType;
    if (patch.nutrition !== undefined) merged.nutrition = patch.nutrition;
    if (patch.nutritionSource !== undefined) merged.nutritionSource = patch.nutritionSource;
    if (patch.usdaFdcId !== undefined) merged.usdaFdcId = patch.usdaFdcId;
    if (patch.isArchived !== undefined) merged.isArchived = patch.isArchived;

    this.upsertLocal(this.withRecomputedCost(merged));
  }
}
