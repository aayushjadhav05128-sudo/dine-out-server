const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  id: {
    type: Number,
    unique: true,
    required: true
  },
  restaurant: {
    type: Number, // Reference to restaurant's numeric id
    required: true,
  },
  restaurant_name: {
    type: String,
    required: true,
  },
  restaurant_image: {
    type: String,
  },
  booking_time: {
    type: String, // e.g., "Tomorrow at 08:30 PM"
    required: true,
  },
  guests: {
    type: Number,
    required: true,
  },
  guest: {
    type: String,
    default: 'Aarav Shah',
  },
  status: {
    type: String,
    enum: ['upcoming', 'confirmed', 'seated', 'fulfilled', 'no-show', 'cancelled', 'Payment Verified', 'Payment Pending'],
    default: 'Payment Pending',
  },
  guest_email: {
    type: String,
  },
  razorpay_order_id: {
    type: String,
  },
  razorpay_payment_id: {
    type: String,
  },
  amount: {
    type: Number,
    default: 20000
  },
  bill_amount: {
    type: Number,
    default: 0
  },
  cover_charge: {
    type: Number,
    default: 0
  },
  commission_percentage: {
    type: Number,
    default: 5
  },
  commission_amount: {
    type: Number,
    default: 0
  },
  payment_status: {
    type: String,
    enum: ['Pending', 'Paid', 'Failed'],
    default: 'Pending'
  },
  settlement_status: {
    type: String,
    enum: ['Pending', 'Settled'],
    default: 'Pending'
  },
  transaction_date: {
    type: Date
  },
  check_in_time: {
    type: Date
  },
  bill_number: {
    type: String
  },
  gst: {
    type: Number,
    default: 0
  },
  offer_applied: {
    type: String
  },
  coupon_used: {
    type: String
  },
  discount: {
    type: Number,
    default: 0
  },
  net_bill: {
    type: Number,
    default: 0
  },
  payment_method: {
    type: String
  },
  platform_commission: {
    type: Number,
    default: 0
  },
  restaurant_earnings: {
    type: Number,
    default: 0
  },
  billing_time: {
    type: Date
  },
  invoice: {
    type: String
  },
  timeline: [{
    timestamp: { type: Date, default: Date.now },
    user: { type: String, default: 'System' },
    status: { type: String },
    event_details: { type: String }
  }]
}, {
  timestamps: true,
});

module.exports = mongoose.model('Booking', bookingSchema);
