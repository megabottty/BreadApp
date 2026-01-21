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

### 4. PWA (Progressive Web App)
The app is configured for mobile-first use:

- **Manifest**: `src/manifest.webmanifest` defines the app icons and splash screen.
- **Service Workers**: Handles caching for offline availability.
- **App Icons**: Stored in `public/` and `src/assets/`.

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
