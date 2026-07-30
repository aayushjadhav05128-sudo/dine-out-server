const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
  },
  role: {
    type: String,
    enum: ['admin', 'owner'],
    default: 'owner',
  },
  restaurantId: {
    type: Number, // Reference to Restaurant's numeric id
    default: null,
  },
  streaks: {
    visited_restaurant_ids: {
      type: [String],
      default: [],
    },
    cuisines_tried: {
      type: [String],
      default: [],
    }
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('User', userSchema);
