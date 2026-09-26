# Features of BreadApp Business

BreadApp Business is a multi-tenant SaaS (Software as a Service) platform designed to empower small business owners. Inspired by the professional ecosystem of lightspeedhq.com, it provides an all-in-one solution for Bakeries, Retail Shops, and Restaurants to manage their operations and finances.

## 🚀 For Business Owners

### 1. Smart Onboarding & Multi-Tenancy
- **Business Type Selection**: Tailor your experience by choosing between **Bakery**, **Retail**, or **Restaurant** modes during setup.
- **Self-Service Onboarding**: Claim your slug and get guided through a 5-step **Setup Wizard** to configure your brand and business specifics in minutes.
- **Dynamic Storefront**: Instantly generated branded storefront for every tenant.

### 2. Business Hub (The Command Center)
A unified dashboard for managing everything:
- **Context-Aware Dashboard**: The interface adapts based on your business type (e.g., "Production" for bakers, "Orders" for retail).
- **Business Ledger**: A professional financial overview showing total revenue, COGS (Cost of Goods Sold), profit margins, and average order value.
- **Inventory Management**: Track stock levels and generate Purchase Orders (POs) automatically.
- **Analytics & Forecasting**: Professional data visualization to help you understand your business health.
- **POS Terminal**: A touch-optimized Point of Sale interface for in-person sales with instant checkout.

### 3. Industry-Specific Tools
- **Bakery Mode**: Professional baker's math calculator, hydration tracking, oven-optimized "Smart Batching", and a **Pantry** of reusable ingredient prices/units/nutrition shared across every recipe (with per-ingredient cost, missing-price and typo warnings shown right in the calculator).
- **Retail Mode**: (In Development) Advanced SKU tracking and inventory life-cycle management.
- **Restaurant Mode**: (In Development) Table management and seating capacity optimization.

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
- **Subscription Model**: Weekly recurring orders for local customers who want their fresh bread "on repeat." Subscribe uses the same dialog as Add to Bag (pack, add-ons, notes) with a one-time / weekly choice; subscriptions require an account so recurring orders can be linked to the customer and managed from their profile (guests are shown why and offered log in / sign up). Pay-at-pickup is unavailable for bags containing a subscription.

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

---

## ✅ Feature Coverage Matrix (Business Model)

Legend: ✅ Implemented · ⚠️ Partial · ❌ Missing/Planned

| Feature | Status | Current Coverage | Gaps / Notes |
| --- | --- | --- | --- |
| Forecasting (data-driven) | ✅ Implemented | 30-day forecast pipeline with backend snapshots and **Business Insights** forecast chart. | Uses simple trend + demand velocity defaults. |
| Top Sellers | ✅ Implemented | Dedicated top sellers table in **Business Insights** backed by backend snapshot API. | Ranked by revenue + units over last 30 days. |
| Supply Planning / Inventory Forecasting | ✅ Implemented | Supply planning table in **Inventory** tab with forecast-driven reorder recommendations. | Uses 30-day forecast, 7-day lead time, safety buffer. |
| Support pop-up events / farmers markets | ❌ Missing | — | Needs events/market calendar + order/channel tagging. |
| Walk‑in orders | ✅ Implemented | POS terminal + order source tracking. | — |
| Marketing campaigns | ⚠️ Partial | Promo code manager in **Ledger**. | Full campaign orchestration missing. |
| Recurring customer orders | ✅ Implemented | Subscribe & Save-style choice in the product dialog, cart badge + summary, account required (UI + `create-checkout-session` guard), Stripe subscription-mode checkout. One `bakery_subscriptions` row per recurring item with the customer's Monday/Tuesday pickup day, contact details and Stripe subscription id. **Skip a week** from the profile / `/subscriptions` (or by texting SKIP); the skipped week is credited on the customer's Stripe balance. A daily scheduler rolls bake dates forward and sends the **Thursday check-in** (text and/or email: reply YES to confirm, SKIP to skip). | Weekly only (no other intervals). |
| Capacity planning / bottlenecks | ⚠️ Partial | Oven capacity setting + Smart Batching foundations. | No capacity/bottleneck visualization or staffing plan. |
| Production planning / scheduling | ⚠️ Partial | Orders + prep timeline + recipe prep/bake time. | No schedule builder tied to forecast & constraints. |
| Financial planning / profit | ⚠️ Partial | Ledger, COGS, profit, margins. | No scenario planning or forward modeling. |
| Cost reviews | ✅ Implemented | Ledger + per-recipe and per-ingredient costs, driven by a shared **Pantry** of ingredient prices; flags unpriced ingredients and implausible per-gram costs instead of silently reading as $0. | No labor/overhead factored into recipe cost. |
| Future/Expansion planning | ❌ Missing | — | Requires forecasting + financial modeling + goals. |
| Market trends | ❌ Missing | — | Needs external data integration. |
| Sales vs cost trend modeling | ⚠️ Partial | Historic metrics in analytics. | No forward‑looking trend modeling. |
| Customer outreach (SMS + Email) | ✅ Implemented | Per-customer **notification preferences** (`bakery_notification_preferences`: weekly check-in, order updates, promotions — each by text and/or email; STOP by text opts out). Order-update texts honour them; the baker can send a **promotion** to everyone who opted in (`POST /api/notifications/promotion`). Inbound SMS webhook handles YES / SKIP / STOP / START. | No campaign scheduling or segmentation beyond the opt-in flags. |
| Reviews & customer connection | ✅ Implemented | Review system + replies. | — |
| Find markets to sell at | ❌ Missing | — | Needs discovery + recommendations. |
| Strategy & business planning | ❌ Missing | — | Needs strategy modules & guided planning. |

### ✅ TODO
- **Move the frontend to a Render Static Site** once ready for a split deployment (keep backend on Render Web Service).
