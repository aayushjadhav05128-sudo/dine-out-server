require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const ngrok = require('ngrok');

// Connect to database
connectDB();

const app = express();

// Body parser middleware
app.use(express.json());

// Routes
app.use('/api/restaurants', require('./routes/restaurantRoutes'));

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Start Ngrok Tunnel
  try {
    const url = await ngrok.connect({
      authtoken: process.env.NGROK_AUTHTOKEN,
      addr: PORT,
    });
    console.log(`\n=================================================`);
    console.log(`🚀 Ngrok Tunnel is Live!`);
    console.log(`🌍 Public URL: ${url}`);
    console.log(`=================================================\n`);
  } catch (error) {
    console.error(`\nFailed to start Ngrok tunnel. Did you set NGROK_AUTHTOKEN in .env?`);
    console.error(`Error details: ${error.message}\n`);
  }
});
