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
  forecastItems = signal<ForecastItem[]>([]);
  topSellers = signal<TopSellerItem[]>([]);
  forecastMeta = signal<ForecastMeta | null>(null);

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

  forecastSummary = computed(() => {
    const items = this.forecastItems();
    const totalUnits = items.reduce((sum, item) => sum + (item.forecast_units || 0), 0);
    const totalRevenue = items.reduce((sum, item) => sum + (item.forecast_revenue || 0), 0);
    return { totalUnits, totalRevenue };
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

  public forecastChartData: ChartData<'line'> = {
    labels: [],
    datasets: [
      {
        data: [],
        label: 'Forecasted Units',
        borderColor: '#D88569',
        backgroundColor: 'rgba(216, 133, 105, 0.15)',
        fill: 'origin',
        tension: 0.4
      }
    ]
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

    effect(() => {
      const items = this.forecastItems();
      const dailyMap = new Map<string, number>();
      items.forEach(item => {
        const key = item.forecast_date;
        dailyMap.set(key, (dailyMap.get(key) || 0) + (item.forecast_units || 0));
      });
      const sortedDates = Array.from(dailyMap.keys()).sort();
      this.forecastChartData = {
        labels: sortedDates.map(date => date.split('-').slice(1).join('/')),
        datasets: [{ ...this.forecastChartData.datasets[0], data: sortedDates.map(date => dailyMap.get(date) || 0) }]
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
      this.http.get<CalculatedRecipe[]>(`${environment.apiUrl}/orders/recipes`, { headers }).toPromise(),
      this.http.get<ForecastResponse>(`${environment.apiUrl}/orders/analytics/forecast`, { headers }).toPromise(),
      this.http.get<TopSellersResponse>(`${environment.apiUrl}/orders/analytics/top-sellers`, { headers }).toPromise()
    ]).then(([orders, recipes, forecastResponse, topSellersResponse]) => {
      this.allOrders.set(orders || []);
      this.savedRecipes.set(recipes || []);
      this.forecastItems.set(forecastResponse?.items || []);
      this.forecastMeta.set(forecastResponse?.forecast || null);
      this.topSellers.set(topSellersResponse?.items || []);
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

interface ForecastItem {
  forecast_date: string;
  recipe_id?: string | null;
  recipe_name: string;
  forecast_units: number;
  forecast_revenue: number;
  order_source?: string;
  confidence_score?: number;
}

interface ForecastMeta {
  id: string;
  start_date: string;
  end_date: string;
  horizon_days: number;
  method: string;
  confidence_level: string;
}

interface ForecastResponse {
  forecast: ForecastMeta;
  items: ForecastItem[];
  trendFactor: number;
  confidenceScore: number;
}

interface TopSellerItem {
  recipeId?: string | null;
  recipeName: string;
  units: number;
  revenue: number;
  rank: number;
}

interface TopSellersResponse {
  items: TopSellerItem[];
}
