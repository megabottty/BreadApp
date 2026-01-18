require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Basic sanity check
app.get('/', (req, res) => {
  res.send('The Daily Dough API is running! 🥖');
});

// We will add real routes here in a moment
const orderRoutes = require('./routes/orders');
app.use('/api/orders', orderRoutes);

app.listen(PORT, () => {
  console.log(`Server is rising on port ${PORT}`);
});
