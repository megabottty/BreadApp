# Features of The Daily Dough

The Daily Dough is a multi-tenant SaaS (Software as a Service) platform designed specifically for artisan bakers. It enables individual bakers to manage their production and finances while providing customers with a beautiful, branded storefront.

## 🚀 For Bakers (The Business Side)

### 1. Multi-Tenant Onboarding
- **Baker Registration**: New bakers can sign up and claim a unique "Shop URL Slug" (e.g., `dailydough.app/mamas-sourdough`).
- **Instant Storefront**: Creating an account automatically sets up a dedicated database tenant and a public storefront.

### 2. Baker Dashboard ("Baker Central")
A unified command center for managing everything:
- **Production Brain**: A daily view of orders. It automatically aggregates ingredients across all orders for a specific "Bake Date," telling the baker exactly how many grams of flour, water, salt, and starter they need for the day.
- **Recipe Calculator**: A professional baker's math calculator that handles hydration percentages and scales recipes based on desired loaf count.
- **Bakery Ledger**: A financial overview showing total revenue, pending sales, and average order value.
- **Order Management**: Track orders through various stages: `PENDING`, `READY`/`SHIPPED`, and `COMPLETED`.

### 3. Marketing & Sales Tools
- **Promo Codes**: Create fixed-amount, percentage-based, or "Free Loaf" discount codes.
- **Customer Communication**: Integrated SMS shortcuts to notify customers when their bread is ready.
- **Dynamic Branding**: Bakers can customize their shop's primary and secondary colors and logo to match their brand.

---

## 🥖 For Customers (The Shopping Side)

### 1. Branded Storefront
- **Dynamic UI**: The storefront automatically adapts its theme (colors, logo, bakery name) based on the URL slug.
- **Product Catalog**: Browse artisan products with photos, descriptions, and average ratings.

### 2. Seamless Ordering
- **Smart Cart**: Add loaves to the cart with real-time price updates.
- **Guest Checkout**: Customers can order without creating an account for maximum speed.
- **Pickup & Shipping**: Supports both local pickup and shipping fulfillment options.

### 3. Loyalty & Reviews
- **Recipe Reviews**: Customers can leave star ratings and comments on specific recipes.
- **Subscription Model**: Weekly recurring orders for local customers who want their fresh bread "on repeat."

---

## 📱 Platform Features

### 1. Progressive Web App (PWA)
- The entire platform can be "installed" on a mobile device (iOS or Android) directly from the browser.
- Looks and feels like a native app with a home screen icon and splash screen.

### 2. Data Isolation
- Robust security ensures that Baker A can never see the recipes, customers, or financial data of Baker B.

### 3. Modern Tech Stack
- **Frontend**: Angular with signals-based state management.
- **Backend**: Node.js/Express.
- **Database**: Supabase (PostgreSQL) with Row-Level Security readiness.
- **Payments**: Integrated with Stripe for secure transactions.
