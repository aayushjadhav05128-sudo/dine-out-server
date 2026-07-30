require('./mongoose_mock');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const ngrok = require('@ngrok/ngrok');

// Connect to database
connectDB();

const app = express();

// Enable CORS
app.use(cors());

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/restaurants', require('./routes/restaurantRoutes'));
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/my-bookings', require('./routes/myBookingsRoutes'));
app.use('/api/offers', require('./routes/offerRoutes'));
app.use('/api/settlements', require('./routes/settlementRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/crm', require('./routes/crmRoutes'));
app.use('/api/chat', require('./routes/chatRoutes'));

// Health check route to keep the server awake
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Dine Hub Server is active' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start Ngrok Tunnel
  if (process.env.NGROK_AUTHTOKEN) {
    try {
      const listener = await ngrok.forward({
        addr: PORT,
        authtoken: process.env.NGROK_AUTHTOKEN,
        domain: 'protraditional-joana-irruptively.ngrok-free.dev',
      });
      const url = listener.url();
      console.log(`\n=================================================`);
      console.log(`🚀 Ngrok Tunnel is Live!`);
      console.log(`🌍 Public URL: ${url}`);
      console.log(`=================================================\n`);
    } catch (error) {
      console.error(`\nFailed to start Ngrok tunnel.`);
      console.error(`Error details: ${error.message}\n`);
    }
  } else {
    console.log(`\nNo NGROK_AUTHTOKEN found in .env. Skipping Ngrok tunnel.\n`);
  }
});

process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('exit', (code) => {
  console.log(`PROCESS EXIT EVENT: Process is exiting with code: ${code}`);
});

process.on('SIGINT', () => {
  console.log('PROCESS SIGINT RECEIVED');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('PROCESS SIGTERM RECEIVED');
  process.exit(0);
});
