import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { RecipeService } from './recipe.service';
import { TenantService } from './tenant.service';
import { environment } from '../../environments/environment';
import { CalculatedRecipe } from '../logic/bakers-math';
import { firstValueFrom } from 'rxjs';

describe('RecipeService', () => {
  let service: RecipeService;
  let httpMock: HttpTestingController;
  const fakeTenant = { id: 't1', slug: 'thedailydough' };
  const tenantStub = {
    tenant: () => fakeTenant
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        RecipeService,
        { provide: TenantService, useValue: tenantStub }
      ]
    });

    service = TestBed.inject(RecipeService);
    httpMock = TestBed.inject(HttpTestingController);

    // stub localStorage.setItem to avoid quota errors during tests
    // use vi.spyOn for the test runner environment
    (global as any).vi?.spyOn ? (vi as any).spyOn(localStorage, 'setItem').mockImplementation(() => {}) : (global as any).spyOn(localStorage, 'setItem').and.callFake(() => {});
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should save recipe and update savedRecipes on success', async () => {
    const input: CalculatedRecipe = { id: null as any, name: 'Test', ingredients: [], price: 5 } as any;
    const returned: CalculatedRecipe = { id: '123', name: 'Test', ingredients: [], price: 5 } as any;

    const promise = firstValueFrom(service.saveRecipe(input));

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/recipes`);
    expect(req.request.method).toBe('POST');
    req.flush(returned);

    const saved = await promise;
    expect(saved.id).toBe('123');
    expect(service.savedRecipes().some(r => r.id === '123')).toBeTruthy();
  });

  it('should fallback to local save when server fails on save', async () => {
    const input: CalculatedRecipe = { id: null as any, name: 'Offline', ingredients: [], price: 3 } as any;

    const promise = firstValueFrom(service.saveRecipe(input));

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/recipes`);
    expect(req.request.method).toBe('POST');
    req.error(new ErrorEvent('network'), { status: 500, statusText: 'Server Error' });

    const saved = await promise;
    expect(saved.id).toBeDefined();
    expect(service.savedRecipes().some(r => r.id === saved.id)).toBeTruthy();
  });

  it('should delete recipe and remove from savedRecipes on success', async () => {
    // seed a recipe
    const seeded = { id: 'del-1', name: 'ToDelete', ingredients: [], price: 1 } as any as CalculatedRecipe;
    service.addLocal(seeded);
    expect(service.savedRecipes().some(r => r.id === 'del-1')).toBeTruthy();

    const promise = firstValueFrom(service.deleteRecipe('del-1'));

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/recipes/del-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({});

    await promise;
    expect(service.savedRecipes().some(r => r.id === 'del-1')).toBeFalsy();
  });

  it('should remove locally even if server delete fails', async () => {
    const seeded = { id: 'del-2', name: 'ToDelete2', ingredients: [], price: 1 } as any as CalculatedRecipe;
    service.addLocal(seeded);
    expect(service.savedRecipes().some(r => r.id === 'del-2')).toBeTruthy();

    const promise = firstValueFrom(service.deleteRecipe('del-2'));

    const req = httpMock.expectOne(`${environment.apiUrl}/orders/recipes/del-2`);
    expect(req.request.method).toBe('DELETE');
    req.error(new ErrorEvent('network'), { status: 500, statusText: 'Server Error' });

    await promise;
    expect(service.savedRecipes().some(r => r.id === 'del-2')).toBeFalsy();
  });

});
