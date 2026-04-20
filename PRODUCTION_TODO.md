# 🚀 Production Readiness TODO

This list tracks the critical tasks required to move BreadApp from a development/hobbyist state to a professional, multi-tenant production environment.

## 🔐 Security & Data Isolation (Phase 1: Highest Priority)
- [x] **Enable Row Level Security (RLS) in Supabase**
    - [x] `bakery_tenants`: Ensure users can only see their own tenant record.
    - [x] `bakery_recipes`: Ensure bakers can only see/edit their own recipes.
    - [x] `bakery_orders`: Ensure customers can see their own orders, and bakers can see orders for their bakery only.
    - [x] `bakery_inventory`: Ensure stock counts are isolated by tenant.
    - [x] `bakery_ingredient_costs`: Ensure product prices are isolated.
- [ ] **Secure Backend Webhooks**
    - [ ] Configure `STRIPE_WEBHOOK_SECRET` in environment variables.
    - [ ] Verify Stripe signatures in `server/routes/payments.js`.

## 💳 Payments & Billing (Phase 2)
- [ ] **Switch to Stripe Live Mode**
    - [ ] Update `STRIPE_PUBLISHABLE_KEY` in `src/environments/environment.prod.ts`.
    - [ ] Update `STRIPE_SECRET_KEY` in server environment variables.
- [x] **Clean Up Development Bypasses**
    - [x] Remove "Development Bypass" button from Setup Wizard.
    - [ ] Remove subscription status bypass logic in backend.
- [ ] **Configure Tax & Shipping**
    - [ ] Set up Stripe Tax for the target regions.

## 📧 Communication & Notifications (Phase 3)
- [ ] **Live SMTP (Emails)**
    - [ ] Choose a provider (SendGrid, Postmark, AWS SES).
    - [ ] Configure `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` in server env.
- [ ] **Live Twilio (SMS)**
    - [ ] Purchase a Twilio phone number.
    - [ ] Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.

## ☁️ Infrastructure & Performance (Phase 4)
- [ ] **Render/Supabase Optimization**
    - [ ] (Optional) Upgrade Render instance to "Starter" to eliminate cold starts.
    - [ ] (Optional) Upgrade Supabase to Pro to avoid 1-week inactivity pausing.
- [ ] **Error Monitoring**
    - [ ] Integrate Sentry for real-time error tracking.
- [ ] **Domain & SSL**
    - [ ] Confirm SSL is active for `thedailydough.store` and subdomains.

## 🎨 Polishing & Marketing (Phase 5)
- [ ] **SEO & Metadata**
    - [ ] Add meta descriptions and social preview images (OpenGraph) to `index.html`.
- [ ] **Analytics**
    - [ ] Integrate Google Analytics or Plausible.io.
- [ ] **Legal Documents**
    - [ ] Add Terms of Service and Privacy Policy pages.
