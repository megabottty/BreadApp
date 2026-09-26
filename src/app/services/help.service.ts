import { Injectable } from '@angular/core';

export interface HelpSection {
  title: string;
  /** One string, or one string per paragraph. */
  content: string | string[];
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
      title: 'Welcome to The Daily Dough',
      content: [
        'The Daily Dough is Megan\'s home bakery in Salt Lake City: naturally leavened sourdough, raised by a 32-year-old starter and baked in small batches. Everything you see here is made by hand and picked up from her home kitchen.',
        'To order: tap a bake to read about it, then "Add to Bag". Some loaves offer extras like sliced or double-baked. When you\'re ready, open your Bag, choose a pickup day (at least two days out so the dough gets its slow rise), enter your details, and pay by card or at pickup.',
        'Want bread every week? Tap "Subscribe" on any bake. Subscriptions need a free account so your weekly order stays linked to you. Pickups are Mondays or Tuesdays, and each Thursday you\'ll get a text or email asking if you want that week\'s bread. Reply YES or SKIP, or pause and cancel anytime from your profile.',
        'Pickup is from Megan\'s home; the exact address is in your confirmation. Questions? Use the contact form at the bottom of the page, email megan@thedailydough.store, or say hi on Instagram @the.daily.dough.'
      ]
    }
  };

  getHint(section: string): HelpSection {
    return this.hints[section] || { title: 'Help', content: 'No specific tips for this section yet.' };
  }
}
