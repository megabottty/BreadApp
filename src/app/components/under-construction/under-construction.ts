import { Component, ChangeDetectionStrategy, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AppLoadService } from '../../services/app-load.service';

@Component({
  selector: 'app-under-construction',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './under-construction.html',
  styleUrls: ['./under-construction.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UnderConstructionComponent implements OnInit {
  phone = '801-471-8218';
  name = 'Megan';

  private appLoadService = inject(AppLoadService);

  ngOnInit() {
    this.appLoadService.setStorefrontReady(true);
  }
}
