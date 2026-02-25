import { Component, inject, signal, computed, effect, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { HelpService } from '../../services/help.service';
import { CommonModule, CurrencyPipe, PercentPipe, DecimalPipe } from '@angular/common';
import { AnalyticsService, RevenueMetric, CategoryMetric } from '../../services/analytics.service';
import { Order, CalculatedRecipe } from '../../logic/bakers-math';
import { TenantService } from '../../services/tenant.service';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType, Chart } from 'chart.js';
import { registerables } from 'chart.js';
import { ModalService } from '../../services/modal.service';

Chart.register(...registerables);

@Component({
  selector: 'app-business-analytics',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  providers: [CurrencyPipe, PercentPipe, DecimalPipe],
  templateUrl: './business-analytics.html',
  styleUrls: ['./business-analytics.css']
})
export class BusinessAnalyticsComponent implements AfterViewInit {
  private analyticsService = inject(AnalyticsService);
  private tenantService = inject(TenantService);
  private http = inject(HttpClient);
  private helpService = inject(HelpService);
  private modalService = inject(ModalService);

  allOrders = signal<Order[]>([]);
  savedRecipes = signal<CalculatedRecipe[]>([]);
  isLoading = signal(true);

  // Stats computed from signals
  revenueMetrics = computed(() => this.analyticsService.getDailyMetrics(this.allOrders(), this.savedRecipes()));
  productMetrics = computed(() => this.analyticsService.getProductPerformance(this.allOrders()));
  sourceMetrics = computed(() => this.analyticsService.getOrderSourceDistribution(this.allOrders()));

  summaryStats = computed(() => {
    const metrics = this.revenueMetrics();
    const totalRevenue = metrics.reduce((sum, m) => sum + m.revenue, 0);
    const totalProfit = metrics.reduce((sum, m) => sum + m.profit, 0);
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const orderCount = this.allOrders().length;
    const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

    return { totalRevenue, totalProfit, margin, orderCount, aov };
  });

  // Chart configurations
  public lineChartData: ChartData<'line'> = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Revenue',
        borderColor: '#006494',
        backgroundColor: 'rgba(0, 100, 148, 0.1)',
        fill: 'origin',
        tension: 0.4
      },
      {
        data: [],
        label: 'Profit',
        borderColor: '#28a745',
        backgroundColor: 'rgba(40, 167, 69, 0.1)',
        fill: 'origin',
        tension: 0.4
      }
    ]
  };

  public lineChartOptions: ChartConfiguration['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: { mode: 'index', intersect: false }
    },
    scales: {
      y: { beginAtZero: true, ticks: { callback: (value) => '$' + value } }
    }
  };

  public doughnutChartData: ChartData<'doughnut'> = {
    labels: [],
    datasets: [{ data: [], backgroundColor: ['#006494', '#D88569', '#7D8F69', '#BA1A1A', '#FFB4A2'] }]
  };

  public barChartData: ChartData<'bar'> = {
    labels: [],
    datasets: [{ data: [], label: 'Orders by Source', backgroundColor: '#006494' }]
  };

  constructor() {
    effect(() => {
      const tenant = this.tenantService.tenant();
      if (tenant) {
        this.loadData();
      }
    });

    // Update charts when data changes
    effect(() => {
      const metrics = this.revenueMetrics();
      this.lineChartData = {
        labels: metrics.map(m => m.date.split('-').slice(1).join('/')),
        datasets: [
          { ...this.lineChartData.datasets[0], data: metrics.map(m => m.revenue) },
          { ...this.lineChartData.datasets[1], data: metrics.map(m => m.profit) }
        ]
      };

      const products = this.productMetrics().slice(0, 5);
      this.doughnutChartData = {
        labels: products.map(p => p.name),
        datasets: [{ ...this.doughnutChartData.datasets[0], data: products.map(p => p.revenue) }]
      };

      const sources = this.sourceMetrics();
      this.barChartData = {
        labels: sources.map(s => s.name),
        datasets: [{ ...this.barChartData.datasets[0], data: sources.map(s => s.value) }]
      };
    });
  }

  ngAfterViewInit() {
    // Chart.js is already initialized via directives
  }

  public loadData() {
    const slug = this.tenantService.tenant()?.slug;
    if (!slug) return;

    this.isLoading.set(true);
    const headers = new HttpHeaders().set('x-tenant-slug', slug);

    // Concurrent load
    Promise.all([
      this.http.get<Order[]>(`${environment.apiUrl}/orders`, { headers }).toPromise(),
      this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).toPromise()
    ]).then(([orders, recipes]) => {
      this.allOrders.set(orders || []);
      this.savedRecipes.set(recipes || []);
      this.isLoading.set(false);
    }).catch(err => {
      console.error('Failed to load analytics data', err);
      this.isLoading.set(false);
    });
  }

  showHint() {
    const hint = this.helpService.getHint('analytics');
    this.modalService.showAlert(hint.content, hint.title, 'info');
  }
}
