import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TenantService } from '../../services/tenant.service';

@Component({
  selector: 'app-starter-guide',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './starter-guide.html',
  styleUrls: ['./starter-guide.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StarterGuideComponent {
  protected readonly tenantService = inject(TenantService);
  starterAge = 32;
  starterName = 'The Heritage Starter';
}
