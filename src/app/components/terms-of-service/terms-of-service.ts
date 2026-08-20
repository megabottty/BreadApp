import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './terms-of-service.html',
  styleUrls: ['./terms-of-service.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TermsOfServiceComponent {}
