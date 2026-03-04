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
- **Bakery Mode**: Professional baker's math calculator, hydration tracking, and oven-optimized "Smart Batching".
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
| Recurring customer orders | ✅ Implemented | Subscriptions in storefront + backend routes. | — |
| Capacity planning / bottlenecks | ⚠️ Partial | Oven capacity setting + Smart Batching foundations. | No capacity/bottleneck visualization or staffing plan. |
| Production planning / scheduling | ⚠️ Partial | Orders + prep timeline + recipe prep/bake time. | No schedule builder tied to forecast & constraints. |
| Financial planning / profit | ⚠️ Partial | Ledger, COGS, profit, margins. | No scenario planning or forward modeling. |
| Cost reviews | ✅ Implemented | Ledger + recipe costs. | — |
| Future/Expansion planning | ❌ Missing | — | Requires forecasting + financial modeling + goals. |
| Market trends | ❌ Missing | — | Needs external data integration. |
| Sales vs cost trend modeling | ⚠️ Partial | Historic metrics in analytics. | No forward‑looking trend modeling. |
| Customer outreach (SMS + Email) | ⚠️ Partial | SMS via Twilio + contact email. | Campaign tooling + segmentation needed. |
| Reviews & customer connection | ✅ Implemented | Review system + replies. | — |
| Find markets to sell at | ❌ Missing | — | Needs discovery + recommendations. |
| Strategy & business planning | ❌ Missing | — | Needs strategy modules & guided planning. |

### ✅ TODO
- **Move the frontend to a Render Static Site** once ready for a split deployment (keep backend on Render Web Service).
