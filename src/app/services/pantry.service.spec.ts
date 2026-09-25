import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PantryItem, PantryService } from './pantry.service';
import { TenantService } from './tenant.service';
import { environment } from '../../environments/environment';

describe('PantryService', () => {
  let service: PantryService;
  let httpMock: HttpTestingController;
  const fakeTenant = { id: 't1', slug: 'thedailydough' };
  const tenantStub = { tenant: () => fakeTenant };

  const breadFlourRow: PantryItem = {
    id: 1,
    name: 'Bread Flour',
    normalizedName: 'bread flour',
    bulkPrice: 15,
    bulkWeight: 5000,
    costPerUnit: null,
    packSize: 5,
    packUnit: 'lb',
    defaultUseUnit: 'g',
    gramsPerCup: 127,
    gramsPerItem: null,
    defaultType: 'FLOUR',
    nutrition: { caloriesPer100g: 364, proteinPer100g: 12, carbsPer100g: 76, fatPer100g: 1.5 },
    nutritionSource: 'USDA',
    usdaFdcId: '12345',
    isArchived: false,
    costPerGram: 0.003,
    costBasis: 'PACK',
    updatedAt: '2026-01-01T00:00:00Z'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PantryService,
        { provide: TenantService, useValue: tenantStub }
      ]
    });

    service = TestBed.inject(PantryService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('load() populates items and byNormalizedName', () => {
    service.load();
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`);
    expect(req.request.method).toBe('GET');
    req.flush([breadFlourRow]);

    expect(service.items()).toEqual([breadFlourRow]);
    expect(service.byNormalizedName().get('bread flour')).toEqual(breadFlourRow);
    expect(service.loaded()).toBe(true);
  });

  it('find() resolves regardless of casing/whitespace', () => {
    service.load();
    httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`).flush([breadFlourRow]);

    expect(service.find('  Bread FLOUR ')?.id).toBe(1);
    expect(service.find('nonexistent')).toBeUndefined();
  });

  it('needsPrice lists only ingredients with no price at all', () => {
    const unpriced: PantryItem = { ...breadFlourRow, id: 2, name: 'Butter', normalizedName: 'butter', bulkPrice: null, bulkWeight: null, costPerUnit: null, costBasis: 'MISSING', costPerGram: 0 };
    service.load();
    httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`).flush([breadFlourRow, unpriced]);

    expect(service.needsPrice().map(i => i.name)).toEqual(['Butter']);
  });

  it('queueSave updates items optimistically before the HTTP request resolves', () => {
    vi.useFakeTimers();
    service.queueSave({ name: 'New Ingredient', bulkPrice: 3, bulkWeight: 1000 });

    // Optimistic local state is visible immediately, before the debounce fires.
    const optimistic = service.find('New Ingredient');
    expect(optimistic).toBeDefined();
    expect(optimistic!.bulkPrice).toBe(3);
    expect(optimistic!.costBasis).toBe('PACK');

    httpMock.expectNone(`${environment.apiUrl}/orders/ingredients/pantry`);

    vi.advanceTimersByTime(600);
    const req = httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`);
    expect(req.request.method).toBe('PUT');
    req.flush({ ...optimistic!, id: 42 });

    expect(service.find('New Ingredient')?.id).toBe(42);
  });

  it('rapid queueSave calls for the same ingredient coalesce into a single request', () => {
    vi.useFakeTimers();
    service.queueSave({ name: 'Butter', bulkPrice: 3 });
    vi.advanceTimersByTime(200);
    service.queueSave({ name: 'Butter', bulkPrice: 4 });
    vi.advanceTimersByTime(200);
    service.queueSave({ name: 'Butter', bulkPrice: 5 });
    vi.advanceTimersByTime(600);

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`);
    expect(req.request.body.bulkPrice).toBe(5); // only the latest edit was sent
    req.flush({ ...req.request.body, id: 7, normalizedName: 'butter', costPerGram: 0, costBasis: 'MISSING' });
  });

  it('a price-only optimistic patch does not clear an existing item\'s local nutrition', () => {
    service.load();
    httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`).flush([breadFlourRow]);

    vi.useFakeTimers();
    service.queueSave({ name: 'Bread Flour', bulkPrice: 20 });

    const optimistic = service.find('Bread Flour');
    expect(optimistic!.bulkPrice).toBe(20);
    expect(optimistic!.nutrition).toEqual(breadFlourRow.nutrition); // untouched

    vi.advanceTimersByTime(600);
    httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`).flush({ ...breadFlourRow, bulkPrice: 20 });
  });

  it('conversionContextFor prefers the pantry\'s own density over any default table', () => {
    service.load();
    httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`).flush([breadFlourRow]);

    const ctx = service.conversionContextFor('Bread Flour');
    expect(ctx.gramsPerCup).toBe(127); // her pantry's own value, not the generic default table's
  });

  it('archive() removes the item locally after the server confirms', () => {
    service.load();
    httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry`).flush([breadFlourRow]);

    let completed = false;
    service.archive(1).subscribe(() => { completed = true; });

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/ingredients/pantry/1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ archived: true });

    expect(completed).toBe(true);
    expect(service.find('Bread Flour')).toBeUndefined();
  });
});
