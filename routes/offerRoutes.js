const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');

// @route   GET /api/offers
// @desc    Get all offers
router.get('/', async (req, res) => {
  try {
    const offers = await Offer.find().sort({ createdAt: -1 });
    res.status(200).json(offers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/offers
// @desc    Create an offer
router.post('/', async (req, res) => {
  try {
    if (!req.body.id) {
      const count = await Offer.countDocuments();
      req.body.id = `O-${count + 1}`;
    }
    const offer = await Offer.create(req.body);
    res.status(201).json(offer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   PUT /api/offers/:id
// @desc    Update an offer by string id or MongoDB _id
router.put('/:id', async (req, res) => {
  try {
    let offer;
    if (req.params.id.startsWith('O-')) {
      offer = await Offer.findOneAndUpdate(
        { id: req.params.id },
        req.body,
        { new: true, runValidators: true }
      );
    } else {
      offer = await Offer.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );
    }

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }
    res.status(200).json(offer);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
