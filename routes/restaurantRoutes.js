const express = require('express');
const router = express.Router();
const Restaurant = require('../models/Restaurant');

// @route   GET /api/restaurants
// @desc    Get all restaurants
router.get('/', async (req, res) => {
  try {
    const restaurants = await Restaurant.find();
    res.status(200).json(restaurants);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/restaurants
// @desc    Create a restaurant
router.post('/', async (req, res) => {
  try {
    const restaurant = await Restaurant.create(req.body);
    res.status(201).json(restaurant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
