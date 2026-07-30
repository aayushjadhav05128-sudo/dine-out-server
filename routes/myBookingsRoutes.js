const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');

// @route   GET /api/my-bookings
// @desc    Get user's bookings (formatted for mobile client)
router.get('/', async (req, res) => {
  try {
    const bookings = await Booking.find().sort({ createdAt: -1 });
    
    // Map to DjangoBooking format
    const formatted = bookings.map(b => ({
      id: b.id,
      restaurant: b.restaurant,
      restaurant_name: b.restaurant_name,
      restaurant_image: b.restaurant_image || '',
      booking_time: b.booking_time,
      guests: b.guests,
      status: b.status,
      cover_charge: b.cover_charge || 0,
      created_at: b.createdAt ? b.createdAt.toISOString() : new Date().toISOString()
    }));

    res.status(200).json(formatted);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
