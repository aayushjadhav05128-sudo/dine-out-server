const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  booking_id: {
    type: String,
    required: true,
  },
  restaurant_id: {
    type: Number, // Numeric restaurant ID
    required: true,
  },
  bill_amount: {
    type: Number,
    required: true,
  },
  discount_applied: {
    type: Number,
    required: true,
  },
  customer_paid: {
    type: Number,
    required: true,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Payment', paymentSchema);
