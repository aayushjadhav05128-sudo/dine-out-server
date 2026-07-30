const mongoose = require('mongoose');

const interactionSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
  },
  restaurant_id: {
    type: Number, // Reference to restaurant's numeric id
    required: true,
  },
  interaction_type: {
    type: String,
    enum: ['profile_view', 'chat_query', 'login', 'signup', 'booking'],
    default: 'profile_view',
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Interaction', interactionSchema);
