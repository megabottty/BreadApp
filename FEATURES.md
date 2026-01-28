# Features of The Daily Dough

The Daily Dough is a multi-tenant SaaS (Software as a Service) platform designed specifically for artisan bakers. It enables individual bakers to manage their production and finances while providing customers with a beautiful, branded storefront.

## 🚀 For Bakers (The Business Side)

### 1. SaaS Multi-Tenant Platform
- **Self-Service Onboarding**: New bakers can register, claim their slug, and are guided through a **Setup Wizard** to configure their bakery in minutes.
- **Dynamic Storefront**: Instantly generated branded storefront for every baker.
- **Subscription Model**: Tiered SaaS plans (Basic vs. Pro) with automatic trial periods for bakers.
- **Billing Management**: Integrated billing portal for bakers to manage their platform subscription.

### 2. Baker Dashboard ("Baker Central")
A unified command center for managing everything:
- **Production Brain**: A daily view of orders. It automatically aggregates ingredients across all orders for a specific "Bake Date," telling the baker exactly how many grams of flour, water, salt, and starter they need for the day.
- **Recipe Calculator**: A professional baker's math calculator that handles hydration percentages and scales recipes based on desired loaf count. Now includes **Time Tracking** (Prep vs. Bake) to power your production schedule and **Nutrition Tracking** with real-time data from the **USDA FoodData Central API**.
- **Production Timeline Planner**: Located in the Forecast tab, this tool calculates exactly when you need to start your day based on your target finish time and the specific recipes in your production plan.
- **Bakery Ledger**: A financial overview showing total revenue, pending sales, and average order value. Manage **Promo Codes** (Fixed, Percentage, or Free Loaf) directly from the ledger.
- **Order Management**: Track orders through various stages: `PENDING`, `READY`/`SHIPPED`, and `COMPLETED`.
- **Integrated Notifications**: Automatically send SMS updates to customers when orders are confirmed, ready for pickup, or out for delivery. Bakers also receive real-time alerts for new orders.
- **Direct Contact Messaging**: Customers can contact bakers directly through a functional contact form in the footer, with messages routed to the baker's email.

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
