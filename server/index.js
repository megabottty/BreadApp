require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Global Request Logger (to see exactly what hits the server)
app.use((req, res, next) => {
  console.log(`[DEBUG LOG] ${new Date().toLocaleTimeString()} - ${req.method} ${req.url}`);
  next();
});

app.use(cors());
app.options(/.*/, cors()); // Enable pre-flight across-the-board
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

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

// Serve Angular static files
app.use(express.static(path.join(__dirname, '../dist/BreadApp/browser')));

// Catch-all route to serve index.html for Angular routing (must be LAST)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../dist/BreadApp/browser/index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is rising on port ${PORT}`);
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (key.startsWith('sk_live')) {
    console.log('⚠️  SERVER STATUS: Running in LIVE mode (sk_live)');
  } else if (key.startsWith('sk_test')) {
    console.log('✅ SERVER STATUS: Running in TEST mode (sk_test)');
  } else {
    console.log('❌ SERVER STATUS: Stripe key not found or invalid format');
  }
});
