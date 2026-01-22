# 🥖 The Daily Dough

The Daily Dough is a multi-tenant SaaS (Software as a Service) platform designed for artisan bakers. It provides a complete solution for bakers to manage their production and for customers to order fresh, handmade bread through a beautiful, branded storefront.

## 🌟 Key Features

- **Multi-Tenant Architecture**: Each baker gets their own branded storefront and isolated data.
- **Baker Dashboard**: Manage recipes, track daily production (auto-calculated ingredients), and view financial ledgers.
- **Recipe Calculator**: Professional baker's math with scaling and hydration tracking.
- **PWA Ready**: Installable on mobile devices for an app-like experience.
- **Customer Storefront**: Subscriptions, reviews, and easy checkout.

See [FEATURES.md](./FEATURES.md) for a full list of capabilities and [TESTING_GUIDE.md](./TESTING_GUIDE.md) for instructions on how to test the app on your phone.

---

## 🛠️ Getting Started

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)
- [Supabase Account](https://supabase.com/)

### 2. Database Setup

1. Create a new project in **Supabase**.
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Copy the contents of `supabase_schema.sql` from this project and run it to create the necessary tables.
4. Enable **Supabase Auth** and ensure the `role` and `full_name` metadata fields are allowed (standard in Supabase).

### 3. Environment Configuration

Create a `.env` file in the root directory and add your credentials:

```env
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key

# Optional: Payment & Communication
STRIPE_SECRET_KEY=your_stripe_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
```

*Note: Also update `src/environments/environment.ts` with your Supabase URL and Key for the frontend.*

### 4. Installation

```bash
npm install
```

---

## 🚀 Running the App

The application consists of an Angular frontend and a Node.js backend.

### Start the Backend Server

```bash
npm run server
```
*The server will start at `http://localhost:3000`.*

### Start the Frontend (Development)

```bash
npm start
```
*Navigate to `http://localhost:4200` in your browser.*

---

## 🧪 Testing

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use:

```bash
npm test
```

---

## 📦 Deployment

### Building for Production

```bash
npm run build
```
This will compile the project and store the build artifacts in the `dist/` directory.

### PWA Support
The app is configured as a Progressive Web App. After building for production and serving via HTTPS, users will be prompted to "Install" the app on their devices.

### Deployment Note (URL Refreshing)
If you are hosting on a traditional server (like Apache/Bluehost), you must ensure that all requests are redirected to `index.html` so that Angular can handle the routing. I have included a `.htaccess` file in the `public/` directory which will be automatically included in your build.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
