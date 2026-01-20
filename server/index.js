require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.options(/.*/, cors()); // Enable pre-flight across-the-board
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

// Basic sanity check
app.get('/', (req, res) => {
  res.send('The Daily Dough API is running! 🥖');
});

// We will add real routes here in a moment
const orderRoutes = require('./routes/orders');
const paymentRoutes = require('./routes/payments');
const notificationRoutes = require('./routes/notifications');

app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);

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
