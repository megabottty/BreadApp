import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { RecipeService } from './recipe.service';

describe('RecipeService draft helpers', () => {
  let service: RecipeService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [RecipeService]
    });

    service = TestBed.inject(RecipeService);
    // Ensure a clean localStorage state for each test
    try { localStorage.removeItem('recipe_calculator_draft'); } catch (e) { /* ignore */ }
  });

  it('should save and load a calculator draft', async () => {
    const draft = { name: 'Test Draft', ingredients: [{ name: 'Flour', weight: 500 }] };

    service.saveCalculatorDraft(draft);
    // wait for requestIdleCallback/setTimeout to run the persist
    await new Promise((r) => setTimeout(r, 0));

    const loaded = service.loadCalculatorDraft();
    expect(loaded).toEqual(draft);
  });

  it('should remove the calculator draft', async () => {
    const draft = { name: 'To Remove' };
    service.saveCalculatorDraft(draft);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.loadCalculatorDraft()).not.toBeNull();

    service.removeCalculatorDraft();
    expect(service.loadCalculatorDraft()).toBeNull();
  });
});
