import { Injectable } from '@angular/core';
import { Order, CalculatedRecipe } from '../logic/bakers-math';

export interface RevenueMetric {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  orderCount: number;
}

export interface CategoryMetric {
  name: string;
  revenue: number;
  count: number;
}

@Injectable({
  providedIn: 'root'
})
export class AnalyticsService {
  /**
   * Generates daily revenue, cost, and profit metrics for a given date range.
   */
  getDailyMetrics(orders: Order[], recipes: CalculatedRecipe[], days: number = 30): RevenueMetric[] {
    const metrics: Record<string, RevenueMetric> = {};
    const today = new Date();

    // Initialize the last X days with zeros to ensure a continuous line
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      metrics[dateStr] = { date: dateStr, revenue: 0, cost: 0, profit: 0, orderCount: 0 };
    }

    orders.forEach(order => {
      // Use createdAt for completed/historical data or pickupDate for future projections
      const datePart = order.createdAt ? order.createdAt.split('T')[0] : (order.pickupDate ? order.pickupDate.split('T')[0] : null);
      if (datePart && metrics[datePart]) {
        metrics[datePart].revenue += order.totalPrice;
        metrics[datePart].orderCount += 1;

        // Calculate cost for this order
        let orderCost = 0;
        order.items.forEach(item => {
          const recipe = recipes.find(r => r.id === item.recipeId) || recipes.find(r => r.name === item.name);
          if (recipe) {
            orderCost += (recipe.totalCost || 0) * (item.quantity || 1);
          }
        });
        metrics[datePart].cost += orderCost;
        metrics[datePart].profit = metrics[datePart].revenue - metrics[datePart].cost;
      }
    });

    return Object.values(metrics).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Aggregates sales by product/category.
   */
  getProductPerformance(orders: Order[]): CategoryMetric[] {
    const productMap: Record<string, CategoryMetric> = {};

    orders.forEach(order => {
      order.items.forEach(item => {
        if (!productMap[item.name]) {
          productMap[item.name] = { name: item.name, revenue: 0, count: 0 };
        }
        productMap[item.name].revenue += (order.totalPrice / order.items.length); // Approximation if no per-item price in order
        productMap[item.name].count += item.quantity;
      });
    });

    return Object.values(productMap).sort((a, b) => b.revenue - a.revenue);
  }

  /**
   * Analyzes order sources (Online, Phone, Walk-in).
   */
  getOrderSourceDistribution(orders: Order[]): { name: string, value: number }[] {
    const sources: Record<string, number> = { 'ONLINE': 0, 'PHONE': 0, 'WALK_IN': 0 };

    orders.forEach(order => {
      const source = order.orderSource || 'ONLINE';
      sources[source] = (sources[source] || 0) + 1;
    });

    return Object.entries(sources).map(([name, value]) => ({ name, value }));
  }

  /**
   * Calculates average order value (AOV) over time.
   */
  getAOVMetric(orders: Order[]): number {
    if (orders.length === 0) return 0;
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalPrice, 0);
    return totalRevenue / orders.length;
  }
}
