const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// Global Request Logger (to see exactly what hits the server)
app.use((req, res, next) => {
  console.log(`[DEBUG LOG] ${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.options(/.*/, cors()); // Enable pre-flight across-the-board
app.use(compression());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Health Check Endpoint (publicly accessible)
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes (all under /api prefix)
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const notificationRoutes = require('./routes/notifications');
const contactRoutes = require('./routes/contact');
const taxRoutes = require('./routes/tax');
const expenseRoutes = require('./routes/expenses');
const notificationSchedulerRoutes = require('./routes/notifications-scheduler');

app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/contact-us', contactRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/notifications-scheduler', notificationSchedulerRoutes);

// Serve Angular static files from the dist directory
app.use(express.static(path.join(__dirname, '../dist/BreadApp/browser'), {
  maxAge: 0,
  etag: true, // Let browser use ETag for simple validation, but check every time
  setHeaders: (res, filePath) => {
    // Force browser to check with server every time
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// The "Catch-all" route for Angular routing
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/BreadApp/browser/index.html'));
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
