const express = require('express');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const { optionalAuth, protect } = require('../middleware/authMiddleware');

// @route   GET /api/restaurants
// @desc    Get all restaurants (filtered for owner if logged in, status 'approved' by default for others, admins see all status types unless specified)
router.get('/', optionalAuth, async (req, res) => {
  try {
    console.log('[GET /api/restaurants] req.user:', req.user);
    console.log('[GET /api/restaurants] req.query:', req.query);
    let query = {};
    if (req.user && req.user.role === 'owner') {
      query = { id: req.user.restaurantId };
    } else if (req.user && req.user.role === 'admin') {
      if (req.query.status) {
        query = { status: req.query.status };
      }
    } else {
      if (req.query.status) {
        query = { status: req.query.status };
      } else {
        query = { status: 'approved' };
      }
    }
    console.log('[GET /api/restaurants] query:', query);
    const restaurants = await Restaurant.find(query);
    res.status(200).json(restaurants);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/restaurants/hidden-gems
// @desc    Get local gems daily shuffled (is_local_gem is true OR (rating >= 4.2 and reviews < 150))
router.get('/hidden-gems', async (req, res) => {
  try {
    const list = await Restaurant.find({
      $or: [
        { is_local_gem: true },
        { 
          rating: { $gte: 4.2 },
          $or: [
            { total_review_count: { $lt: 150 } },
            { reviews: { $lt: 150 } }
          ]
        }
      ]
    });

    if (list.length === 0) {
      // Fallback: send top rated under-reviewed
      const fallback = await Restaurant.find({ rating: { $gte: 4.0 } }).limit(5);
      return res.status(200).json(fallback);
    }

    // Deterministic daily shuffle based on date string
    const dateStr = new Date().toDateString();
    let seed = 0;
    for (let i = 0; i < dateStr.length; i++) {
      seed += dateStr.charCodeAt(i);
    }

    const shuffled = [...list];
    let m = shuffled.length, t, idx;
    while (m) {
      // Seeded linear congruential style generator
      const x = Math.sin(seed++) * 10000;
      const rand = x - Math.floor(x);
      idx = Math.floor(rand * m--);
      t = shuffled[m];
      shuffled[m] = shuffled[idx];
      shuffled[idx] = t;
    }

    res.status(200).json(shuffled);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/restaurants/:id
// @desc    Get a restaurant by numeric id
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Owners can only view their own restaurant details if logged in
    if (req.user && req.user.role === 'owner' && Number(id) !== req.user.restaurantId) {
      return res.status(403).json({ message: 'Access denied: you do not own this restaurant' });
    }

    const restaurant = await Restaurant.findOne({ id: Number(id) });
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }
    res.status(200).json(restaurant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/restaurants
// @desc    Create a restaurant (admins only)
router.post('/', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: admins only' });
  }
  try {
    // Generate numeric id if not provided
    if (!req.body.id) {
      const maxRes = await Restaurant.findOne().sort({ id: -1 });
      req.body.id = maxRes ? maxRes.id + 1 : 1000;
    }
    const restaurant = await Restaurant.create(req.body);
    res.status(201).json(restaurant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   PUT /api/restaurants/:id
// @desc    Update a restaurant by numeric id or MongoDB _id (admins or specific owner)
router.put('/:id', protect, async (req, res) => {
  try {
    const { id } = req.params;
    let numericId = Number(id);

    // If ID is mongo _id, fetch it first to check numeric id
    let restaurant;
    if (isNaN(numericId)) {
      restaurant = await Restaurant.findById(id);
    } else {
      restaurant = await Restaurant.findOne({ id: numericId });
    }

    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }

    // Owner checks
    if (req.user.role === 'owner' && restaurant.id !== req.user.restaurantId) {
      return res.status(403).json({ message: 'Access denied: you do not own this restaurant' });
    }

    // Only admins can change status
    if (req.user.role !== 'admin' && req.body.status !== undefined) {
      delete req.body.status;
    }

    Object.assign(restaurant, req.body);
    await restaurant.save();

    res.status(200).json(restaurant);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   POST /api/restaurants/ai-match
// @desc    Parse natural language food cravings and return matching restaurants
router.post('/ai-match', async (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ message: 'Query is required' });
  }

  try {
    // 1. Natural Language Parse (cheesy, pricing, distance)
    let budget = null;
    const budgetRegex = /(?:under|below|less\s+than|₹|rs\.?)\s*(\d+)/i;
    const budgetMatch = query.match(budgetRegex);
    if (budgetMatch) {
      budget = parseInt(budgetMatch[1]);
    }

    let distance = 15; // default max distance
    const distanceRegex = /(?:within|under|less\s+than)?\s*(\d+(?:\.\d+)?)\s*(?:km|kilometers)/i;
    const distanceMatch = query.match(distanceRegex);
    if (distanceMatch) {
      distance = parseFloat(distanceMatch[1]);
    }

    // Parse cravings
    let cravingKeywords = [];
    const queryLower = query.toLowerCase();

    if (queryLower.includes('chees') || queryLower.includes('pizza') || queryLower.includes('burger') || queryLower.includes('fast')) {
      cravingKeywords.push('burger', 'pizza', 'fast-food', 'american', 'italian', 'cheese');
    }
    if (queryLower.includes('indian') || queryLower.includes('curry') || queryLower.includes('punjabi') || queryLower.includes('naan') || queryLower.includes('paneer') || queryLower.includes('thali') || queryLower.includes('south') || queryLower.includes('north')) {
      cravingKeywords.push('indian', 'south indian', 'north indian', 'curry', 'thali', 'breakfast', 'legendary');
    }
    if (queryLower.includes('chinese') || queryLower.includes('noodle') || queryLower.includes('dim sum') || queryLower.includes('momo')) {
      cravingKeywords.push('chinese', 'asian', 'noodle', 'momos');
    }
    if (queryLower.includes('italian') || queryLower.includes('pasta') || queryLower.includes('continental')) {
      cravingKeywords.push('italian', 'pasta', 'pizza', 'continental');
    }
    if (queryLower.includes('seafood') || queryLower.includes('fish') || queryLower.includes('coastal') || queryLower.includes('crab')) {
      cravingKeywords.push('seafood', 'coastal', 'mangalorean', 'crab');
    }
    if (queryLower.includes('cafe') || queryLower.includes('coffee') || queryLower.includes('brunch') || queryLower.includes('shake')) {
      cravingKeywords.push('cafe', 'coffee', 'shake');
    }
    if (queryLower.includes('beer') || queryLower.includes('brew') || queryLower.includes('drink') || queryLower.includes('pub') || queryLower.includes('night')) {
      cravingKeywords.push('bar', 'brewery', 'pub', 'nightlife', 'beer');
    }

    // 2. Query Restaurants
    let dbQuery = {};
    if (budget) {
      // priceForTwo matches two people, so we look for restaurant priceForTwo <= budget * 2
      dbQuery.priceForTwo = { $lte: budget * 2 };
    }

    let list = await Restaurant.find(dbQuery);

    // 3. Filter by distance
    list = list.filter(r => r.distanceKm <= distance);

    // 4. Score and Rank relevance
    const scoredList = list.map(r => {
      let score = 0;
      const resName = r.name.toLowerCase();
      const resCuisine = r.cuisine.toLowerCase();
      const resCategory = r.category.toLowerCase();
      const resAbout = (r.about || '').toLowerCase();

      cravingKeywords.forEach(kw => {
        if (resName.includes(kw)) score += 10;
        if (resCuisine.includes(kw)) score += 8;
        if (resCategory.includes(kw)) score += 6;
        if (resAbout.includes(kw)) score += 4;
      });

      // Factor in rating (higher rating = boost score)
      score += r.rating * 3;
      
      // Factor in trending (boost score)
      if (r.trending) score += 5;

      return { restaurant: r, score };
    });

    scoredList.sort((a, b) => b.score - a.score);
    const top3 = scoredList.slice(0, 3).map(item => item.restaurant);

    res.status(200).json({
      parsed: {
        craving: cravingKeywords.join(', ') || 'general',
        budget: budget,
        max_distance_km: distance
      },
      matches: top3
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/restaurants/mystery-meal
// @desc    Choose a random partner matching budget tier, cuisine, and dietary status
router.post('/mystery-meal', async (req, res) => {
  const { budgetTier, cuisine, dietary } = req.body;

  try {
    let query = {};
    if (budgetTier) {
      query.tier_pricing = Number(budgetTier);
    }
    if (dietary) {
      query.dietary_type = dietary;
    }

    let list = await Restaurant.find(query);

    // If cuisine is specified, filter by matching text
    if (cuisine && list.length > 0) {
      const cuisineLower = cuisine.toLowerCase();
      
      // Mapping categories/cuisines
      list = list.filter(r => {
        const rCuisine = r.cuisine.toLowerCase();
        const rName = r.name.toLowerCase();
        
        if (cuisineLower === 'north indian') {
          return rCuisine.includes('indian') || rCuisine.includes('gujarati') || rCuisine.includes('mangalorean') || rCuisine.includes('seafood') || rCuisine.includes('coastal') || rName.includes('bhavan') || rName.includes('mtr');
        }
        if (cuisineLower === 'chinese') {
          return rCuisine.includes('chinese') || rCuisine.includes('asian') || rCuisine.includes('noodle');
        }
        if (cuisineLower === 'italian') {
          return rCuisine.includes('italian') || rCuisine.includes('pizza') || rCuisine.includes('pasta');
        }
        if (cuisineLower === 'continental') {
          return rCuisine.includes('continental') || rCuisine.includes('american') || rCuisine.includes('burger') || rCuisine.includes('fast food');
        }
        return rCuisine.includes(cuisineLower);
      });
    }

    // Filter within 5km if list has items, otherwise fall back to everything
    const nearby = list.filter(r => r.distanceKm <= 5);
    const selectionSource = nearby.length > 0 ? nearby : (list.length > 0 ? list : await Restaurant.find({}));

    if (selectionSource.length === 0) {
      return res.status(404).json({ message: 'No restaurants match your criteria' });
    }

    // Pick random
    const randomIndex = Math.floor(Math.random() * selectionSource.length);
    const chosen = selectionSource[randomIndex];

    // Generate coupon code
    const codes = ['MYSTERY50', 'CHEFSECRET80', 'HUNGRY20', 'DINEHUBGIFT', 'LOCALGOLD'];
    const coupon = `${codes[Math.floor(Math.random() * codes.length)]}-${Math.floor(1000 + Math.random() * 9000)}`;

    res.status(200).json({
      id: chosen.id,
      name: chosen.name,
      cuisine: chosen.cuisine,
      location: chosen.location,
      image: chosen.image_url,
      latitude: chosen.latitude,
      longitude: chosen.longitude,
      couponCode: coupon,
      status: 'locked'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/restaurants/update-streaks
// @desc    Update customer dining streaks records in MongoDB user profile
router.post('/update-streaks', optionalAuth, async (req, res) => {
  try {
    const { visitedRestaurantId, cuisine } = req.body;

    if (req.user) {
      const User = require('../models/User');
      const user = await User.findById(req.user.id);
      if (user) {
        if (!user.streaks) {
          user.streaks = { visited_restaurant_ids: [], cuisines_tried: [] };
        }

        let updated = false;
        if (visitedRestaurantId && !user.streaks.visited_restaurant_ids.includes(String(visitedRestaurantId))) {
          user.streaks.visited_restaurant_ids.push(String(visitedRestaurantId));
          updated = true;
        }

        if (cuisine && !user.streaks.cuisines_tried.includes(cuisine)) {
          user.streaks.cuisines_tried.push(cuisine);
          updated = true;
        }

        if (updated) {
          user.markModified('streaks');
          await user.save();
        }

        return res.status(200).json({
          message: 'Streaks updated successfully',
          streaks: user.streaks
        });
      }
    }

    res.status(200).json({ message: 'Streaks handled locally for guest', streaks: null });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/restaurants/onboard
// @desc    Public endpoint to request restaurant onboarding from the partner landing page
router.post('/onboard', async (req, res) => {
  const { name, city, phone, email } = req.body;

  if (!name || !city || !phone || !email) {
    return res.status(400).json({ message: 'All fields are required (name, city, phone, email).' });
  }

  try {
    // Generate new numeric id dynamically based on existing restaurants
    const maxRes = await Restaurant.findOne().sort({ id: -1 });
    const newId = maxRes ? maxRes.id + 1 : 1000;

    const newRestaurant = await Restaurant.create({
      id: newId,
      name,
      location: city,
      cuisine: 'Continental, Multi-Cuisine',
      phone,
      email,
      status: 'pending',
    });

    console.log(`[Onboarding] Created pending restaurant: ${name} (ID: ${newId})`);

    // Trigger Admin Ethereal/SMTP email alert in the background
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      const mailOptions = {
        from: `"Dine Hub Onboarding" <${process.env.SMTP_USER}>`,
        to: process.env.SMTP_USER,
        subject: `🚨 [Dine Hub Onboarding] New Request: ${name}`,
        text: `A new restaurant has requested onboarding:\n\n- Restaurant Name: ${name}\n- City: ${city}\n- Phone: ${phone}\n- Email: ${email}\n- ID: ${newId}\n\nReview this request in the database.`,
        html: `
          <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
            <h2 style="color: #FC8019;">New Onboarding Request 🛎️</h2>
            <p>A new restaurant has submitted an onboarding request on the Swiggy Dineout landing page:</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 150px;">Restaurant Name:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>${name}</strong></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">City:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${city}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Phone:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${phone}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Generated ID:</td>
                <td>${newId} (Pending Approval)</td>
              </tr>
            </table>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 11px; color: #999;">Dine Hub Onboarding System</p>
          </div>
        `
      };

      transporter.sendMail(mailOptions, (error) => {
        if (error) console.error('[Onboarding Email] Failed to notify admin:', error);
        else console.log('[Onboarding Email] Notified admin successfully');
      });
    }

    res.status(201).json({
      success: true,
      message: 'Onboarding request submitted successfully!',
      restaurant: newRestaurant
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PATCH /api/restaurants/onboard/status/:id
// @desc    Approve or reject a restaurant onboarding request
router.patch('/onboard/status/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status. Must be approved or rejected.' });
  }

  try {
    const restaurant = await Restaurant.findOneAndUpdate(
      { id: Number(id) },
      { status },
      { new: true }
    );

    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant onboarding request not found.' });
    }

    res.status(200).json({
      success: true,
      message: `Restaurant onboarding request ${status} successfully.`,
      restaurant
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
