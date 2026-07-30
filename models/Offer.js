const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ['Flat', 'Bank', 'BOGO', 'Percent'],
    required: true,
  },
  discount: {
    type: String,
    required: true,
  },
  restaurants: {
    type: Number, // Number of participating restaurants
    default: 0,
  },
  startsAt: {
    type: String,
    required: true,
  },
  endsAt: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Offer', offerSchema);
