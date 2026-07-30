const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
  id: {
    type: Number,
    unique: true,
    required: true
  },
  name: {
    type: String,
    required: [true, 'Please add a restaurant name'],
  },
  location: {
    type: String,
    required: [true, 'Please add a location'],
  },
  cuisine: {
    type: String,
    required: [true, 'Please add a cuisine type'],
  },
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0,
  },
  distanceKm: {
    type: Number,
    default: 1.5,
  },
  reviews: {
    type: Number,
    default: 0,
  },
  priceForTwo: {
    type: Number,
    default: 500,
  },
  image_url: {
    type: String,
    default: '',
  },
  category: {
    type: String,
    default: 'fine-dining',
  },
  offer_text: {
    type: String,
    default: '',
  },
  trending: {
    type: Boolean,
    default: false,
  },
  gallery: [{
    type: String,
  }],
  about: {
    type: String,
    default: '',
  },
  latitude: {
    type: Number,
    default: 12.9716,
  },
  longitude: {
    type: Number,
    default: 77.5946,
  },
  is_local_gem: {
    type: Boolean,
    default: false,
  },
  total_review_count: {
    type: Number,
    default: 0,
  },
  tier_pricing: {
    type: Number,
    enum: [200, 500, 1000],
    default: 500,
  },
  dietary_type: {
    type: String,
    enum: ['veg', 'non-veg', 'eggitarian'],
    default: 'non-veg',
  },
  phone: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['approved', 'pending', 'rejected'],
    default: 'approved',
  },
  revenue: {
    type: Number,
    default: 0,
  },
  commission_percentage: {
    type: Number,
    default: 5,
  },
  settlement_cycle: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'weekly',
  },
  pending_commission: {
    type: Number,
    default: 0,
  },
  total_commission_paid: {
    type: Number,
    default: 0,
  },
  last_settlement_date: {
    type: Date,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Restaurant', restaurantSchema);
