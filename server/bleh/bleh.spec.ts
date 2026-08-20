import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Bleh } from './bleh';

describe('Bleh', () => {
  let component: Bleh;
  let fixture: ComponentFixture<Bleh>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Bleh]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Bleh);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
