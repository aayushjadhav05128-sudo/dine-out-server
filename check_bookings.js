require('dotenv').config();
const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  id: Number,
  restaurant: Number,
  restaurant_name: String,
  booking_time: String,
  guests: Number,
  guest: String,
  status: String
});

const Booking = mongoose.model('Booking', bookingSchema);

async function checkBookings() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected successfully!');
    const bookings = await Booking.find({});
    console.log('Total bookings found in DB:', bookings.length);
    console.log(JSON.stringify(bookings, null, 2));
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error querying DB:', error);
  }
}

checkBookings();
