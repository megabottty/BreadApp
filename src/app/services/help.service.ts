import { Injectable } from '@angular/core';

export interface HelpSection {
  title: string;
  content: string;
}

@Injectable({
  providedIn: 'root'
})
export class HelpService {
  private hints: Record<string, HelpSection> = {
    'dashboard': {
      title: 'Business Hub Overview',
      content: 'Welcome to your Command Center! From here, you can access your POS, manage production, track finances, and view analytics. Use the sidebar to navigate between different business functions.'
    },
    'orders': {
      title: 'Production & Order Management',
      content: 'Track all incoming orders here. The "Production Brain" aggregates ingredients for the selected date, helping you know exactly how much flour, water, and yeast to prep. Mark orders as "Ready" or "Shipped" to keep customers informed.'
    },
    'pos': {
      title: 'Point of Sale (POS)',
      content: 'Use this terminal for in-person sales. It\'s touch-optimized for speed. Search products, add to cart, and complete sales with Cash or Card. For Restaurants, you can also assign a table number.'
    },
    'ledger': {
      title: 'Business Ledger & Promos',
      content: 'Track your financial health. COGS (Cost of Goods Sold) is calculated based on your recipe ingredient costs. Use the Promo Manager to create discount codes for marketing campaigns.'
    },
    'recipes': {
      title: 'Smart Recipe Calculator',
      content: 'This isn\'t just a list—it\'s a mathematical tool. It calculates true hydration, nutrition, and cost-per-loaf. Use the "Scaling" feature to adjust a recipe for any number of units instantly.'
    },
    'inventory': {
      title: 'ERP & Inventory Tracking',
      content: 'The system automatically tracks ingredient usage from completed orders. Set "Low Stock" thresholds to get alerts, and use the "Generate PO" button to create a purchase list based on next week\'s production needs.'
    },
    'analytics': {
      title: 'Business Insights',
      content: 'Understand your growth trends. Compare revenue vs. profit, see your best-selling products, and identify which sales channels (Online, POS, Phone) are performing best.'
    },
    'setup-wizard': {
      title: 'Tailored Onboarding',
      content: 'BreadApp adapts to you. Choose "Bakery" for oven-specific tools, "Retail" for SKU focus, or "Restaurant" for table management. Your colors and logo will define your public storefront.'
    },
    'storefront': {
      title: 'Your Branded Storefront',
      content: 'This is what your customers see. It\'s fully responsive and PWA-ready, meaning customers can "install" it on their phones like a native app. They can browse products, leave reviews, and place orders.'
    }
  };

  getHint(section: string): HelpSection {
    return this.hints[section] || { title: 'Help', content: 'No specific tips for this section yet.' };
  }
}
