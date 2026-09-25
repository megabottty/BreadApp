# Technical Guide: The Daily Dough Architecture

This document provides a deeper look into the technical architecture of **The Daily Dough**, explaining how multi-tenancy, authentication, and the production engine work.

## 🏗️ Architecture Overview

The application is built as a decoupled system with an **Angular** frontend and a **Node.js/Express** backend, using **Supabase** as the primary data store and authentication provider.

### 1. Multi-Tenancy (SaaS Model)
The app uses a **Single Database, Shared Schema** approach with a `tenant_id` for data isolation.

- **Tenants Table**: Stores bakery-specific info (name, slug, colors, logo, subscription status).
- **Slug Identification**: The `TenantService` on the frontend identifies the current bakery based on the URL path (`/b/slug`) or subdomain.
- **Onboarding Flow**: New bakers are automatically redirected to the `SetupWizardComponent` upon registration to configure their branding, oven capacity, and select a SaaS subscription plan (**Starter**, **Professional**, or **Enterprise**).
  - **Development Bypass**: For testing purposes, the Stripe credit card requirement in the Setup Wizard can be bypassed. Look for `// --- START STRIPE BYPASS ---` in `setup-wizard.ts` to toggle between mock and real payment flows.
- **Backend Enforcement**: The `tenantMiddleware` in `server/routes/orders.js` extracts the `x-tenant-slug` header from requests and injects the corresponding `tenant_id` into the database queries.

### 2. Authentication & Roles
Powered by **Supabase Auth**.

- **User Roles**: Users have a `role` metadata attribute: `BAKER` or `CUSTOMER`.
- **Guards**: Angular route guards (`authGuard`, `bakerGuard`) ensure that only authorized users can access the dashboard or profile pages.

### 3. Production Engine (Baker's Math)
The core logic resides in `src/app/logic/bakers-math.ts`.

- **Hydration Calculation**: Automatically calculates the "True Hydration" of a recipe based on flour and water weights (including the contribution from the starter).
- **Ingredient Aggregation**: The `OrdersManager` takes multiple orders for a specific date and runs them through an aggregation algorithm to produce a "Daily Grams Breakdown" for the baker.
- **Nutrition & Search**: The `IngredientService` searches the **USDA FoodData Central API** through the backend proxy `GET /api/orders/ingredients/search?q=` (`server/utils/usda.cjs`, in-memory cache, `USDA_API_KEY`). The browser never calls USDA directly, so CSP/CORS/rate-limit failures don't surface as "unable to connect" errors. Nutrition is stored per ingredient inside `bakery_recipes.ingredients` (survives re-saves) **and** in the pantry (survives a page reload before the recipe is ever saved — see Pantry & Units below). A USDA *Branded* result also carries `brandName`/`packageWeight`/`fdcId`; picking one pre-fills the recipe row's package weight via `parsePackageWeight` in `src/app/logic/units.ts`.
- **Pantry & Units**: `PantryService` (`src/app/services/pantry.service.ts`) is the per-tenant ingredient catalog — package price/weight, unit, density, nutrition — reused across every recipe instead of re-entered each time. Backed by the `bakery_ingredient_costs` table (see Data Schema) via `GET/PUT/DELETE /api/orders/ingredients/pantry`. Prices save immediately as they're edited (debounced ~600ms, see `PantryService.queueSave`), not only when the whole recipe is saved. The **"My Pantry"** screen (`/ingredients`, `IngredientManagerComponent`) is where prices/units/density are reviewed directly, with an "⚠ Needs a price" filter.
  - **Unit conversion**: `src/app/logic/units.ts` converts an entered amount (g, kg, oz, lb, cup, tbsp, tsp, or "each") to canonical grams via `toGrams()`. Volume/count units need a density (`gramsPerCup`/`gramsPerItem`) — the pantry's own value wins, else a generic table by ingredient name, always flagged `assumed: true` in the UI (with a one-time prompt to correct it, which then saves to the pantry). **`bakers-math.ts` never imports this module** — `Ingredient.weight` is always the canonical gram value; conversion happens once, at the point she types an amount, not inside the math itself.
- **Cost visibility**: `calculateBakersMath()` also returns a `costBreakdown` (`unpricedIngredientNames`, `costCoverageRatio`, dismissible `warnings` for an implausible per-gram cost or a likely 100g/1000g package-size typo) and a per-ingredient `cost`/`costPerGram`/`costBasis` (`PACK` | `LEGACY` | `FREE` | `MISSING`) — an unpriced ingredient is called out rather than silently counted as $0. `src/app/logic/pack-options.ts`'s `calculatePackEconomics()` extends this per pack option (cost/margin per pack, not just the whole batch).
- **Customer Nutrition Display**: Nutrition is computed per gram of batch weight (`nutritionPerGram`). When a recipe has `item_weight_grams` (finished weight of one loaf/bagel/cookie), the storefront shows whole-item figures and lets the customer enter how many grams they'll eat.
- **Pack Options**: Products can carry `pack_options` (`[{id,label,size,price}]`, price is for the whole pack) edited in the recipe calculator. `src/app/logic/pack-options.ts` resolves them, falling back to standard pricing (cookies 1/$3, 6/$10, 12/$20; bagels 4/$12, 8/$20, blueberry +$2) when none are saved.

### 4. Communication & Notifications
Powered by **Twilio** with a built-in mock fallback for development.

- **SMS Workflow**: The `NotificationService` handles automated customer updates for order milestones (`Order Confirmation`, `Ready for Pickup`, `Out for Delivery`) and `Baker Alerts` for new orders.
- **Fail-safe Mocking**: If Twilio credentials are missing in the environment, the backend gracefully logs messages to the console instead of failing.
- **Customer SMS Shortcuts**: Bakers can manually trigger SMS notifications from the dashboard using the `NotificationService`.
- **Contact Form Emailing**: The 'Contact Us' form uses **Nodemailer** to route customer messages to the baker's registered email address. If no specific baker email is found, it defaults to the platform admin.

### 5. PWA & Mobile Optimization
The app is designed with a **mobile-first** approach:

- **Manifest**: `src/manifest.webmanifest` defines the app icons and splash screen.
- **Service Workers**: Handles caching for offline availability.
- **Responsive Layouts**: 
  - **Baker Dashboard**: Uses a sticky horizontal navigation on mobile to maximize workspace.
  - **Grid Systems**: Automatically transition from multi-column to single-column layouts on small screens.
  - **Touch-Friendly**: Buttons and inputs are sized (min 48px to 52px height) for easy interaction on mobile devices.
  - **iOS Optimization**: Inputs use `font-size: 16px` to prevent automatic zooming on Safari.
- **App Icons**: Stored in `public/` and `src/assets/`.
- **Custom Install Prompt**: For iOS and other browsers, a custom guided "Install App" prompt is implemented to improve discoverability and user experience.

### 5. Hosting & URL Rewriting (SPA Refresh Fix)
Since this is a Single Page Application (SPA), traditional servers (Apache) need to be told how to handle sub-routes. I have added a `.htaccess` file in the `public/` directory.

When you build the app (`npm run build`), this file is copied to the root of your `dist/` folder. It tells the server to redirect any unknown URLs back to `index.html` so Angular can handle them, preventing the "404 page" on refresh.

---

## 💾 Data Schema

Key tables in the Supabase database:

- `bakery_tenants`: Master list of bakeries. Stores branding (colors, logo), settings (`oven_capacity`, `default_bake_temp`, `default_bake_time`), and subscription status.
- `bakery_recipes`: Product definitions, ingredients (JSONB, each with optional `nutrition`, and optional `amount`/`unit`/`gramsPerCup`/`gramsPerItem` — display-only; `weight` is always the canonical grams value), prices, `pack_options` (JSONB), `serving_size_grams`, `item_weight_grams`, and production metadata (`prep_time_minutes`, `bake_time_minutes`).
- `bakery_orders`: Transactional records. Includes `fulfillment_type` (Pickup/Shipping), `order_source` (Online/Phone/Walk-in), and `promo_code`.
- `bakery_reviews`: Customer feedback and star ratings with baker reply support.
- `bakery_subscriptions`: Recurring weekly order schedules for customers.
- `bakery_promos`: Discount codes (Fixed, Percent, Free Loaf) scoped to each tenant.
- `bakery_ingredient_costs`: The baker's **pantry** — one row per `(tenant_id, name)`. Physical table name is historical (it started as cost-only); it now also owns `pack_size`/`pack_unit`, `default_use_unit`, `grams_per_cup`/`grams_per_item` (density), `nutrition`/`nutrition_source`, and `is_archived` (soft delete — a hard delete would silently zero the cost of any recipe that still names this ingredient). `bulk_price`/`bulk_weight` (grams) stay the canonical price/weight the cost formula reads; everything else is display/context around them. See `server/utils/pantry.cjs`.

**TODO (RLS):** Re-enable Row Level Security for `bakery_recipes` once proper `SELECT`/`INSERT`/`UPDATE` policies are in place for tenant-scoped access.

---

## 🔌 API Endpoints (Backend)

The Node.js server (`server/index.js`) exposes several key routes under the `/api` prefix:

- **Orders & Tenants**: `GET /api/orders` (all orders for tenant), `POST /api/orders` (place order), `GET /api/orders/info` (tenant branding/settings).
- **Recipes**: `GET /api/orders/recipes` (catalog), `POST /api/orders/recipes` (save recipe).
- **Ingredients**: `GET /api/orders/ingredients/search?q=` (USDA nutrition lookup proxy). **Pantry**: `GET/PUT /api/orders/ingredients/pantry` (`PUT` is a single-item create-or-merge, keyed by name — deliberately not a batch upsert, since that would blank fields a partial patch didn't mean to touch), `DELETE /api/orders/ingredients/pantry/:id` (soft delete). `GET/POST /api/orders/ingredients/costs` still work (read/write the same `bulk_price`/`bulk_weight`/`cost_per_unit` columns) but are deprecated in favor of the pantry routes above.
- **Promos**: `GET /api/orders/promos/all`, `POST /api/orders/promos`, `DELETE /api/orders/promos/:id`.
- **Notifications**: `POST /api/notifications/send-sms`.
- **Onboarding**: `POST /api/orders/register-bakery`.
- **Contact Us**: `POST /api/contact` (routes messages to baker/admin email).

---

## ⚙️ Environment Variables (Server)
To enable full functionality, ensure your `.env` file includes the following:

### 1. Database (Supabase)
- `SUPABASE_URL`: Your project URL.
- `SUPABASE_KEY`: Your service_role or anon key.

### 2. Ingredient Search (USDA)
- `USDA_API_KEY`: FoodData Central key (free at https://fdc.nal.usda.gov/api-key-signup). Falls back to `DEMO_KEY`, which is limited to ~30 requests/hour.

### 3. Notifications (Twilio)
- `TWILIO_ACCOUNT_SID`: Your account SID.
- `TWILIO_AUTH_TOKEN`: Your auth token.
- `TWILIO_PHONE_NUMBER`: Your Twilio number.

### 3. Email (Nodemailer/SMTP)
- `SMTP_HOST`: e.g., `smtp.gmail.com` or `smtp.sendgrid.net`.
- `SMTP_PORT`: e.g., `587` or `465`.
- `SMTP_USER`: Your SMTP username.
- `SMTP_PASS`: Your SMTP password.
- `SMTP_SECURE`: `true` for port 465, `false` otherwise.
- `CONTACT_EMAIL_FROM`: The address that appears as the sender (e.g., `"The Daily Dough" <noreply@yourdomain.com>`).
- `DEFAULT_CONTACT_EMAIL`: Fallback recipient for general inquiries.

---

## 📖 User Guides & Integrations

### 1. Toast Integration
ToastTab is used to sync in-store POS data with the bakery dashboard.
- **Setup**: In the Baker Dashboard (Settings), enter your Toast Client ID.
- **Workflow**: Orders from Toast sync automatically to the 'Orders' tab for production planning.
- **Payments**: Toast handles physical POS payments, while **Stripe** handles all online storefront transactions.
  - **Payment Bypass (Dev Mode)**: To skip Stripe validation in the Setup Wizard during development:
    1. Open `src/app/components/setup-wizard/setup-wizard.ts`.
    2. Ensure the code under `// --- START STRIPE BYPASS ---` is active (returns `true` and uses `SUB_MOCK_`).
    3. To reactivate, uncomment the sections labeled `// --- UNCOMMENT FOR PRODUCTION ---`.

### 2. Inventory & Production
- **Batch Production List**: Automatically calculated in the 'Orders' tab. It aggregates all individual customer orders into a total gram-count for each recipe.
- **Smart Batches**: The system automatically groups orders into optimized oven batches. Bakers can configure their **Oven Capacity** (e.g., 4 or 6 loaves) in the Settings tab, which the algorithm uses to partition the production plan.
- **Location & Map**: Bakers can set their physical shop address in the Settings tab. This dynamically updates the embedded Google Map in the storefront footer, making it easy for customers to find them for pickups.
- **Adding Inventory**: Ingredient prices/weights live in the **Pantry** (`/ingredients`), edited either there directly or inline from the Recipe Calculator's per-ingredient cost chip — either way they save immediately, independent of saving the recipe. `server/scripts/backfill-pantry.cjs [--dry-run]` seeds the pantry from ingredients already sitting inside existing recipes, for a one-time migration onto this system.
- **Generate PO**: Compares current stock levels against the 'Production Plan' (next 7 days) and generates a purchase order for missing ingredients.

### 3. Sales Forecasting & Production Planning
- **Multi-Channel Predictions**: Forecasts are broken down by channel (Walk-in, Phone, Online).
- **Confidence Levels**: The system provides a confidence percentage based on the depth of historical data available.
- **Demand Patterns**: Weekly patterns are visualized to help bakers plan labor and ingredient prep.
- **Production Timeline**: Calculates the optimal start time for your bake day. By setting a "Target Finish Time" and defining "Prep Time" and "Bake Time" in each recipe, the system identifies the lead time required to ensure all products are ready when your shop opens.
