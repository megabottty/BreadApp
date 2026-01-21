# 🧪 Testing & Mobile Viewing Guide

This guide explains how to test the registration flow and how to view **The Daily Dough** as an app on your mobile phone.

---

## 📝 Testing the Registration Flow

The registration flow supports two main roles: **Bread Lover (Customer)** and **The Baker**.

### 1. Test as a Baker (SaaS Onboarding)
1. Start the backend: `npm run server`
2. Start the frontend: `npm start`
3. Navigate to `http://localhost:4200/register`.
4. Select **"The Baker"** tab.
5. Fill in the **Bakery Name** (e.g., "Mama's Sourdough") and **Shop URL Slug** (e.g., "mamas-bread").
6. Complete the personal details and click **"Create Account"**.
7. **Expected Result**: 
   - A new tenant is created in your Supabase `bakery_tenants` table.
   - You are redirected to the **Baker Dashboard** (Recipe Calculator).
   - Your browser tab title should change to "Mama's Sourdough | Powered by The Daily Dough".

### 2. Test as a Customer
1. Navigate to `http://localhost:4200/register`.
2. Select **"Bread Lover"** tab.
3. Fill in your details and click **"Create Account"**.
4. **Expected Result**: 
   - You are redirected to the **Storefront** (`/front`).
   - You can now leave reviews or manage subscriptions in your profile.

---

## 📱 Seeing it as an App on your Phone

To see the app on your phone during development, your phone and computer must be on the **same Wi-Fi network**.

### Option A: Local Network (Quickest)
1. **Find your Computer's IP Address**:
   - macOS: `System Settings > Wi-Fi > Details` (e.g., `192.168.1.15`)
2. **Start the Frontend for External Access**:
   - Run: `npm start -- --host 0.0.0.0`
   - *This tells the development server to listen on all network interfaces.*
3. **Access on Phone**:
   - Open Safari (iOS) or Chrome (Android).
   - Type in: `http://192.168.1.15:4200` (Replace with your actual IP).

### Option B: Using ngrok (Recommended for PWA testing)
PWAs usually require **HTTPS** to show the "Install" prompt. [ngrok](https://ngrok.com/) provides a secure tunnel with HTTPS.
1. Install ngrok: `brew install ngrok/ngrok/ngrok`
2. Start your app: `npm start`
3. In a new terminal, run: `ngrok http 4200`
4. Open the `https://...` link provided by ngrok on your phone.

---

## 🚀 Installing as an App (PWA)

Once you have the app open on your phone via HTTPS (ngrok) or a deployed URL:

### On iOS (Safari):
1. Tap the **Share** button (the square with an arrow).
2. Scroll down and tap **"Add to Home Screen"**.
3. Tap **"Add"**. The "DailyDough" icon will now appear on your home screen like a native app.

### On Android (Chrome):
1. Tap the **three dots** (menu) in the top-right corner.
2. Tap **"Install app"** or **"Add to Home screen"**.
3. Follow the prompts.

---

## 🛠️ Troubleshooting
- **Backend Connection**: Ensure your mobile phone can also reach your backend server. If using the Local Network method, you may need to update `src/app/services/tenant.service.ts` and others to use your Computer's IP instead of `localhost:3000`.
- **Supabase Auth**: Ensure your Supabase project allows the redirect URLs in the Auth settings dashboard.
