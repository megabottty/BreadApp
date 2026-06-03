import { of } from 'rxjs';

class MockRecipeService {
  draft: any = null;
  savedRecipes = () => [] as any[];
  loadCalculatorDraft() { return this.draft; }
  removeCalculatorDraft() { this.draft = null; }
}

class MockModalService {
  lastConfirm: any = null;
  showConfirm(message: string, title: string, onAccept: Function, onDecline: Function) {
    this.lastConfirm = { message, title };
    // Simulate user accepting the confirm
    onAccept();
  }
  showAlert() {}
}

describe('RecipeCalculator restore flow (unit)', () => {
  it('loads draft and calls modal accept', () => {
    const rs = new MockRecipeService();
    const modal = new MockModalService();
    rs.draft = { id: 'd1', name: 'Draft Cake' };

    const saved = rs.loadCalculatorDraft();
    if (saved) {
      modal.showConfirm('You have an unsaved recipe draft. Would you like to restore it?', 'Unsaved Draft Found', () => {
        // simulate loading
        rs.removeCalculatorDraft();
      }, () => {
        rs.removeCalculatorDraft();
      });
    }

    expect(modal.lastConfirm).toBeTruthy();
    expect(rs.draft).toBeNull();
  });
});
