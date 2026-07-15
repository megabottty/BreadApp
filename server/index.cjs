const path = require('path');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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
const siteMode = (process.env.SITE_MODE || 'admin-preview').toLowerCase() === 'public' ? 'public' : 'admin-preview';
const frontendUrl = process.env.FRONTEND_URL || 'https://thedailydough.store';

const defaultAllowedOrigins = [
  'https://thedailydough.store',
  'https://www.thedailydough.store',
  'http://localhost:4200',
  'http://localhost:4300'
];
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const allowedOrigins = new Set([...defaultAllowedOrigins, ...configuredCorsOrigins]);

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

// Request logging can significantly slow production traffic; keep it opt-in there.
if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_REQUEST_LOGS === 'true') {
  app.use((req, res, next) => {
    console.log(`[DEBUG LOG] ${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);
    next();
  });
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

const corsOptions = {
  origin: (origin, callback) => {
    // Allow same-origin/non-browser requests (no Origin header)
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(compression());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false
});

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);
app.use('/api/contact-us', sensitiveLimiter);
app.use('/api/orders/register-bakery', sensitiveLimiter);
app.use('/api/payments/create-checkout-session', sensitiveLimiter);
app.use('/api/payments/create-setup-session', sensitiveLimiter);

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

app.get('/api/config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    siteMode,
    apiUrl: '/api',
    frontendUrl,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_KEY || '',
    stripePublicKey: process.env.STRIPE_PUBLIC_KEY || ''
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
const HASHED_ASSET_REGEX = /-[A-Za-z0-9]{8,}\.(?:js|css|mjs)$/;

app.use(express.static(distPath, {
  maxAge: '1y',
  etag: true,
  setHeaders: (res, filePath) => {
    const filename = path.basename(filePath);
    if (filename === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }

    if (HASHED_ASSET_REGEX.test(filename)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }

    // Manifest/favicon and other non-hashed assets get modest caching.
    res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

// The "Catch-all" route for Angular routing — MUST be after express.static
// This regex matches paths that don't start with /api and don't have file extensions
app.use((req, res, next) => {
  // If it's not an API route and doesn't have a file extension, it's an Angular route
  if (!req.path.startsWith('/api') && !req.path.match(/\.[a-zA-Z0-9]+$/)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
