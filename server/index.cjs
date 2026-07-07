const path = require('path');
const fs = require('fs');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const pkg = require('../package.json');
const serverStartedAt = new Date();
const deployCommit =
  process.env.RENDER_GIT_COMMIT
  || process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.RAILWAY_GIT_COMMIT_SHA
  || process.env.SOURCE_VERSION
  || process.env.GITHUB_SHA
  || '';
const deployVersion = `${pkg.version}+${Math.floor(serverStartedAt.getTime() / 1000)}`;

// Environment validation (fail fast in production for critical secrets)
if (process.env.NODE_ENV === 'production') {
  const required = ['STRIPE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[ENV ERROR] Missing required environment variables in production:', missing.join(', '));
    console.error('TIP: Check for typos. You might have SUPABASE_KEY instead of SUPABASE_SERVICE_KEY.');
    console.error('TIP: If you are deploying to Render, ensure these variables are added in the Dashboard > Environment section.');
    console.error('Current environment variables:', Object.keys(process.env).filter(k => !k.includes('KEY') && !k.includes('SECRET') && !k.includes('TOKEN')).join(', '));
    // Exit so deployments clearly fail rather than run insecurely
    process.exit(1);
  }
} else {
  // Development-time helpful warnings
  if (!process.env.SUPABASE_URL) console.warn('[ENV WARNING] SUPABASE_URL not set');
  if (!process.env.STRIPE_SECRET_KEY) console.warn('[ENV WARNING] STRIPE_SECRET_KEY not set');
}

// Global Request Logger (to see exactly what hits the server)
app.use((req, res, next) => {
  console.log(`[DEBUG LOG] ${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.options(/.*/, cors()); // Enable pre-flight across-the-board
app.use(compression());

// Specifically mount the webhook route BEFORE global body parser
// This is critical for Stripe signature verification
const paymentRoutes = require('./routes/payments.cjs');
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentRoutes);

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Health Check Endpoint (publicly accessible)
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Version / deployment info endpoint
app.get('/api/version', (req, res) => {
  res.status(200).json({
    version: deployVersion,
    appVersion: pkg.version,
    name: pkg.name,
    deployedAt: serverStartedAt.toISOString(),
    commit: deployCommit || null,
    nodeEnv: process.env.NODE_ENV || 'development',
    stripeMode: (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live') ? 'live' : 'test',
  });
});

// API Routes (all under /api prefix)
const orderRoutes = require('./routes/orders.cjs');
const notificationRoutes = require('./routes/notifications.cjs');
const contactRoutes = require('./routes/contact.cjs');
const taxRoutes = require('./routes/tax.cjs');
const expenseRoutes = require('./routes/expenses.cjs');
const notificationSchedulerRoutes = require('./routes/notifications-scheduler.cjs');

app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/contact-us', contactRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/notifications-scheduler', notificationSchedulerRoutes);

// Serve Angular static files from the dist directory
const distPath = path.join(__dirname, '../dist/BreadApp/browser');

// Middleware to rewrite build-time placeholders (like masked supabaseKey) with runtime env values
// This runs BEFORE express.static to intercept and modify files
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path.endsWith('.js')) {
    const filePath = path.join(distPath, req.path);
    // Prevent directory traversal
    if (!filePath.startsWith(distPath)) return next();
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.debug(`[JS Rewrite] Failed to read ${req.path}:`, err.message);
        return next();
      }
      const realKey = process.env.SUPABASE_KEY || '';
      console.debug(`[JS Rewrite] Processing ${req.path}, SUPABASE_KEY env length: ${realKey.length}`);
      // Replace both variants: "supabaseKey":"******" and supabaseKey:"******"
      let replaced = data.replace(/"supabaseKey"\s*:\s*"\*+"/g, `"supabaseKey":"${realKey}"`);
      replaced = replaced.replace(/supabaseKey\s*:\s*"\*+"/g, `supabaseKey:"${realKey}"`);
      if (replaced !== data) {
        console.log(`[JS Rewrite] ✅ Injected real SUPABASE_KEY into ${req.path}`);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.send(replaced);
      }
      console.debug(`[JS Rewrite] No placeholder found in ${req.path}`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(data);
    });
    return;
  }
  next();
});

app.use(express.static(distPath, {
  maxAge: 0,
  etag: true,
  setHeaders: (res, _filePath) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// The "Catch-all" route for Angular routing — MUST be after express.static
// This regex matches paths that don't start with /api and don't have file extensions
app.use((req, res, next) => {
  // If it's not an API route and doesn't have a file extension, it's an Angular route
  if (!req.path.startsWith('/api') && !req.path.match(/\.[a-zA-Z0-9]+$/)) {
    res.sendFile(path.join(distPath, 'index.html'));
  } else {
    next();
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (key.startsWith('sk_live')) {
    console.log('⚠️  SERVER STATUS: Running in LIVE mode (sk_live)');
  } else if (key.startsWith('sk_test')) {
    console.log('✅ SERVER STATUS: Running in TEST mode (sk_test)');
  } else {
    console.log('❌ SERVER STATUS: Stripe key not found or invalid format');
  }
});
