const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  partner: {
    type: String,
    required: true,
  },
  bookings: {
    type: Number,
    default: 0,
  },
  gross: {
    type: Number,
    required: true,
  },
  commission: {
    type: Number,
    required: true,
  },
  payout: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['paid', 'pending', 'processing'],
    default: 'pending',
  },
  date: {
    type: String, // e.g. "2026-06-01"
    required: true,
  },
  cover_charges_collected: {
    type: Number,
    default: 0,
  },
  commission_percentage: {
    type: Number,
    default: 5,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Settlement', settlementSchema);
