const mongoose = require('mongoose');

const restaurantSchema = new mongoose.Schema({
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
  menuItems: [{
    name: String,
    price: Number,
    description: String,
  }],
}, {
  timestamps: true,
});

module.exports = mongoose.model('Restaurant', restaurantSchema);
