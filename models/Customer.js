const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  phone_number: {
    type: String,
    sparse: true,
    unique: true,
  },
  email: {
    type: String,
    default: '',
  },
  instagram_id: {
    type: String,
    default: '',
  },
  facebook_id: {
    type: String,
    default: '',
  },
  totalVisits: {
    type: Number,
    default: 0,
  },
  lifetimeSpend: {
    type: Number,
    default: 0,
  },
  averageBill: {
    type: Number,
    default: 0,
  },
  favouriteRestaurants: {
    type: [String],
    default: [],
  },
  favouriteCuisine: {
    type: String,
    default: 'Indian',
  },
  offersRedeemed: {
    type: Number,
    default: 0,
  },
  lastVisit: {
    type: Date,
  },
  customerSegment: {
    type: String,
    default: 'Regular',
  },
  loyaltyPoints: {
    type: Number,
    default: 0,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Customer', customerSchema);
