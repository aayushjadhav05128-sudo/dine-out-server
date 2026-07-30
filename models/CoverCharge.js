const mongoose = require('mongoose');

const coverChargeSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true
  },
  booking_id: {
    type: Number,
    required: true
  },
  customer_name: {
    type: String,
    required: true
  },
  customer_phone: {
    type: String
  },
  restaurant_name: {
    type: String,
    required: true
  },
  guests: {
    type: Number,
    required: true
  },
  amount: {
    type: Number, // in paise
    required: true
  },
  payment_status: {
    type: String,
    enum: ['Pending', 'Paid', 'Failed'],
    default: 'Pending'
  },
  transaction_id: {
    type: String
  },
  payment_gateway: {
    type: String,
    default: 'Razorpay'
  },
  payment_time: {
    type: Date
  },
  refund_status: {
    type: String,
    enum: ['None', 'Pending', 'Refunded'],
    default: 'None'
  },
  reservation_status: {
    type: String,
    default: 'upcoming'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('CoverCharge', coverChargeSchema);
