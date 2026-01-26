# Technical Guide: The Daily Dough Architecture

This document provides a deeper look into the technical architecture of **The Daily Dough**, explaining how multi-tenancy, authentication, and the production engine work.

## 🏗️ Architecture Overview

The application is built as a decoupled system with an **Angular** frontend and a **Node.js/Express** backend, using **Supabase** as the primary data store and authentication provider.

### 1. Multi-Tenancy (SaaS Model)
The app uses a **Single Database, Shared Schema** approach with a `tenant_id` for data isolation.

- **Tenants Table**: Stores bakery-specific info (name, slug, colors, logo).
- **Slug Identification**: The `TenantService` on the frontend identifies the current bakery based on the URL path (`/b/slug`) or subdomain.
- **Backend Enforcement**: The `tenantMiddleware` in `server/routes/orders.js` extracts the `x-tenant-slug` header from requests and injects the corresponding `tenant_id` into the database queries.

### 2. Authentication & Roles
Powered by **Supabase Auth**.

- **User Roles**: Users have a `role` metadata attribute: `BAKER` or `CUSTOMER`.
- **Guards**: Angular route guards (`authGuard`, `bakerGuard`) ensure that only authorized users can access the dashboard or profile pages.

### 3. Production Engine (Baker's Math)
The core logic resides in `src/app/logic/bakers-math.ts`.

- **Hydration Calculation**: Automatically calculates the "True Hydration" of a recipe based on flour and water weights (including the contribution from the starter).
- **Ingredient Aggregation**: The `OrdersManager` takes multiple orders for a specific date and runs them through an aggregation algorithm to produce a "Daily Grams Breakdown" for the baker.

### 4. PWA & Mobile Optimization
The app is designed with a **mobile-first** approach:

- **Manifest**: `src/manifest.webmanifest` defines the app icons and splash screen.
- **Service Workers**: Handles caching for offline availability.
- **Responsive Layouts**: 
  - **Baker Dashboard**: Uses a sticky horizontal navigation on mobile to maximize workspace.
  - **Grid Systems**: Automatically transition from multi-column to single-column layouts on small screens.
  - **Touch-Friendly**: Buttons and inputs are sized (min 48px height) for easy interaction on mobile devices.
- **App Icons**: Stored in `public/` and `src/assets/`.

### 5. Hosting & URL Rewriting (SPA Refresh Fix)
Since this is a Single Page Application (SPA), traditional servers (Apache/Bluehost) need to be told how to handle sub-routes. I have added a `.htaccess` file in the `public/` directory.

When you build the app (`npm run build`), this file is copied to the root of your `dist/` folder. It tells the server to redirect any unknown URLs back to `index.html` so Angular can handle them, preventing the "Bluehost Splash Page" on refresh.

---

## 💾 Data Schema

Key tables in the Supabase database:

- `bakery_tenants`: The master list of all bakeries on the platform.
- `bakery_recipes`: Product definitions, ingredients, and prices.
- `bakery_orders`: Transactional records linking customers to specific recipes and tenants.
- `bakery_reviews`: Customer feedback and star ratings.
- `bakery_subscriptions`: Recurring weekly order schedules.
- `bakery_promos`: Discount codes unique to each tenant.

---

## 🔌 API Endpoints (Backend)

The Node.js server (`server/index.js`) exposes several key routes:

- `GET /api/orders/info`: Fetches branding for the current tenant.
- `POST /api/orders`: Saves a new order (handles guest checkout).
- `GET /api/orders/recipes`: Retrieves the product catalog for a specific tenant.
- `POST /api/orders/register-bakery`: Onboards a new baker.

---

## 📖 User Guides & Integrations

### 1. Toast Integration
ToastTab is used to sync in-store POS data with the bakery dashboard.
- **Setup**: In the Baker Dashboard (Settings), enter your Toast Client ID.
- **Workflow**: Orders from Toast sync automatically to the 'Orders' tab for production planning.
- **Payments**: Toast handles physical POS payments, while **Stripe** handles all online storefront transactions.

### 2. Inventory & Production
- **Batch Production List**: Automatically calculated in the 'Orders' tab. It aggregates all individual customer orders into a total gram-count for each recipe.
- **Smart Batches**: The system automatically groups orders into optimized oven batches. Bakers can configure their **Oven Capacity** (e.g., 4 or 6 loaves) in the Settings tab, which the algorithm uses to partition the production plan.
- **Location & Map**: Bakers can set their physical shop address in the Settings tab. This dynamically updates the embedded Google Map in the storefront footer, making it easy for customers to find them for pickups.
- **Adding Inventory**: Inventory items are managed via the 'Recipe Calculator'. When you save a recipe with ingredient costs and weights, they are tracked in the Inventory system.
- **Generate PO**: Compares current stock levels against the 'Production Plan' (next 7 days) and generates a purchase order for missing ingredients.

### 3. Sales Forecasting & Production Planning
- **Multi-Channel Predictions**: Forecasts are broken down by channel (Walk-in, Phone, Online).
- **Confidence Levels**: The system provides a confidence percentage based on the depth of historical data available.
- **Demand Patterns**: Weekly patterns are visualized to help bakers plan labor and ingredient prep.
- **Production Timeline**: Calculates the optimal start time for your bake day. By setting a "Target Finish Time" and defining "Prep Time" and "Bake Time" in each recipe, the system identifies the lead time required to ensure all products are ready when your shop opens.
