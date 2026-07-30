const express = require('express');
const router = express.Router();
const Settlement = require('../models/Settlement');
const Restaurant = require('../models/Restaurant');
const Booking = require('../models/Booking');
const { protect } = require('../middleware/authMiddleware');

// @route   GET /api/settlements
// @desc    Get all settlements (filtered for owners)
router.get('/', protect, async (req, res) => {
  try {
    let query = {};
    if (req.user.role === 'owner') {
      const restaurant = await Restaurant.findOne({ id: req.user.restaurantId });
      if (restaurant) {
        query = { partner: restaurant.name };
      } else {
        query = { partner: 'Unknown' };
      }
    }
    const settlements = await Settlement.find(query).sort({ createdAt: -1 });
    res.status(200).json(settlements);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/settlements/generate
// @desc    Automated settlement generation: scans pending bookings, aggregates commission ledger records
router.post('/generate', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: Admin authority required' });
  }

  try {
    const pendingBookings = await Booking.find({
      status: { $in: ['Payment Verified', 'fulfilled'] },
      settlement_status: 'Pending'
    });

    if (pendingBookings.length === 0) {
      return res.status(200).json({ success: true, message: 'No pending bookings found for settlement generation.' });
    }

    const bookingsByRes = {};
    for (const booking of pendingBookings) {
      if (!bookingsByRes[booking.restaurant]) {
        bookingsByRes[booking.restaurant] = [];
      }
      bookingsByRes[booking.restaurant].push(booking);
    }

    const generatedReports = [];

    for (const resId in bookingsByRes) {
      const restaurant = await Restaurant.findOne({ id: Number(resId) });
      if (!restaurant) continue;

      const groupBookings = bookingsByRes[resId];
      let totalBilled = 0;       // in paise
      let totalCoverCharge = 0;  // in paise
      let totalCommission = 0;   // in paise

      for (const b of groupBookings) {
        totalBilled += b.bill_amount || 0;
        totalCoverCharge += b.cover_charge || 0;
        totalCommission += b.commission_amount || 0;
      }

      const grossINR = totalBilled / 100;
      const coverChargesINR = totalCoverCharge / 100;
      const commissionINR = totalCommission / 100;
      const payoutINR = grossINR - commissionINR;

      const settlementId = `S-${Math.floor(100000 + Math.random() * 900000)}`;

      const newSettlement = await Settlement.create({
        id: settlementId,
        partner: restaurant.name,
        bookings: groupBookings.length,
        gross: grossINR,
        commission: commissionINR,
        payout: payoutINR,
        cover_charges_collected: coverChargesINR,
        commission_percentage: restaurant.commission_percentage || 5,
        status: 'pending',
        date: new Date().toISOString().split('T')[0]
      });

      await Booking.updateMany(
        { _id: { $in: groupBookings.map(b => b._id) } },
        { $set: { settlement_status: 'Settled' } }
      );

      restaurant.total_commission_paid = (restaurant.total_commission_paid || 0) + totalCommission;
      restaurant.pending_commission = 0;
      restaurant.last_settlement_date = new Date();
      await restaurant.save();

      generatedReports.push(newSettlement);
    }

    res.status(201).json({
      success: true,
      message: `Successfully generated ${generatedReports.length} settlement cycles.`,
      settlements: generatedReports
    });
  } catch (error) {
    console.error('Failed to generate settlements:', error);
    res.status(500).json({ message: 'Failed to generate settlements', details: error.message });
  }
});

// @route   PUT /api/settlements/:id/pay
// @desc    Manually mark a settlement status as paid
router.put('/:id/pay', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: Admin authority required' });
  }

  try {
    const settlement = await Settlement.findOne({ id: req.params.id });
    if (!settlement) {
      return res.status(404).json({ message: 'Settlement record not found.' });
    }

    settlement.status = 'paid';
    await settlement.save();

    res.status(200).json({
      success: true,
      message: `Settlement ${settlement.id} marked as paid successfully.`,
      settlement
    });
  } catch (error) {
    console.error('Failed to update settlement status:', error);
    res.status(500).json({ message: 'Failed to update settlement status', details: error.message });
  }
});

// @route   GET /api/settlements/analytics
// @desc    Get comprehensive settlement analytics (KPIs, Charts, Top Restaurants)
router.get('/analytics', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // If owner, only fetch data for their restaurant
    let restaurantQuery = {};
    let bookingQuery = { status: { $in: ['Payment Verified', 'fulfilled'] } };

    if (req.user.role === 'owner') {
      restaurantQuery = { id: req.user.restaurantId };
      bookingQuery.restaurant = req.user.restaurantId;
    }

    const restaurants = await Restaurant.find(restaurantQuery);
    const bookings = await Booking.find(bookingQuery);

    let kpis = {
      totalRestaurants: restaurants.length,
      totalBookings: bookings.length,
      totalGrossRevenue: 0,
      totalCoverCharges: 0,
      totalCommission: 0,
      totalPendingCommission: 0,
      totalSettledCommission: 0,
      totalDineHubRevenue: 0,
      todayBilled: 0,
      todayCommission: 0,
      todayCoverCharges: 0,
      todaySettled: 0,
      todayPending: 0
    };

    const restaurantMap = {};
    restaurants.forEach(r => {
      restaurantMap[r.id] = {
        id: r.id,
        name: r.name,
        commission_percentage: r.commission_percentage || 5,
        bookingsCount: 0,
        grossBilled: 0,
        coverCharges: 0,
        commissionOwed: 0,
        commissionPaid: 0,
        pendingCommission: 0,
        status: 'Pending'
      };
    });

    // Daily series logic (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateMap = {};

    for (let i = 0; i < 30; i++) {
      const d = new Date(thirtyDaysAgo);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      dateMap[dateStr] = {
        date: dateStr,
        revenue: 0,
        commission: 0,
        bookings: 0,
        coverCharges: 0
      };
    }

    bookings.forEach(b => {
      const billINR = (b.bill_amount || 0) / 100;
      const coverINR = (b.cover_charge || 0) / 100;
      const commINR = (b.commission_amount || 0) / 100;
      const bDate = b.transaction_date ? new Date(b.transaction_date) : new Date(b.createdAt);
      const dateStr = bDate.toISOString().split('T')[0];

      kpis.totalGrossRevenue += billINR;
      kpis.totalCoverCharges += coverINR;
      kpis.totalCommission += commINR;

      if (b.settlement_status === 'Settled') {
        kpis.totalSettledCommission += commINR;
      } else {
        kpis.totalPendingCommission += commINR;
      }

      // Check if today
      if (bDate >= today) {
        kpis.todayBilled += billINR;
        kpis.todayCommission += commINR;
        kpis.todayCoverCharges += coverINR;
        if (b.settlement_status === 'Settled') {
          kpis.todaySettled += commINR;
        } else {
          kpis.todayPending += commINR;
        }
      }

      if (restaurantMap[b.restaurant]) {
        restaurantMap[b.restaurant].bookingsCount++;
        restaurantMap[b.restaurant].grossBilled += billINR;
        restaurantMap[b.restaurant].coverCharges += coverINR;
        restaurantMap[b.restaurant].commissionOwed += commINR;
        if (b.settlement_status === 'Settled') {
          restaurantMap[b.restaurant].commissionPaid += commINR;
        } else {
          restaurantMap[b.restaurant].pendingCommission += commINR;
        }
      }

      if (dateMap[dateStr]) {
        dateMap[dateStr].revenue += billINR;
        dateMap[dateStr].commission += commINR;
        dateMap[dateStr].bookings++;
        dateMap[dateStr].coverCharges += coverINR;
      }
    });

    kpis.totalDineHubRevenue = kpis.totalCoverCharges + kpis.totalSettledCommission;

    const perRestaurantList = Object.values(restaurantMap).map(r => {
      // Calculate status
      if (r.pendingCommission === 0 && r.commissionPaid > 0) r.status = 'Paid';
      else if (r.pendingCommission > 0 && r.commissionPaid > 0) r.status = 'Partially Paid';
      else r.status = 'Pending';
      return r;
    });

    const topRestaurants = [...perRestaurantList].sort((a, b) => b.grossBilled - a.grossBilled).slice(0, 5);

    const seriesData = Object.values(dateMap);

    res.json({
      kpis,
      perRestaurant: perRestaurantList,
      topRestaurants,
      series: seriesData
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/settlements/transactions
// @desc    Get detailed list of booking transactions with filters
router.get('/transactions', protect, async (req, res) => {
  try {
    const { restaurant, dateFrom, dateTo, settlementStatus, paymentStatus, search } = req.query;

    let query = { status: { $in: ['Payment Verified', 'fulfilled'] } };

    if (req.user.role === 'owner') {
      query.restaurant = req.user.restaurantId;
    } else if (restaurant && restaurant !== 'All') {
      query.restaurant_name = restaurant;
    }

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const dTo = new Date(dateTo);
        dTo.setHours(23, 59, 59, 999);
        query.createdAt.$lte = dTo;
      }
    }

    if (settlementStatus && settlementStatus !== 'All') {
      query.settlement_status = settlementStatus;
    }
    
    if (paymentStatus && paymentStatus !== 'All') {
      query.payment_status = paymentStatus;
    }

    if (search) {
      query.$or = [
        { guest: { $regex: search, $options: 'i' } },
        { razorpay_order_id: { $regex: search, $options: 'i' } }
      ];
    }

    const transactions = await Booking.find(query).sort({ createdAt: -1 }).limit(500); // Limit to recent 500 for perf

    const formatted = transactions.map(t => ({
      id: t.id,
      bookingId: t.id,
      customerName: t.guest,
      restaurantName: t.restaurant_name,
      billAmount: (t.bill_amount || 0) / 100,
      coverCharge: (t.cover_charge || 0) / 100,
      commissionPercentage: t.commission_percentage || 5,
      commissionAmount: (t.commission_amount || 0) / 100,
      paymentStatus: t.payment_status,
      settlementStatus: t.settlement_status,
      date: t.transaction_date || t.createdAt,
      transactionId: t.razorpay_payment_id || 'N/A'
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/settlements/restaurant/:restaurantId
// @desc    Get a specific restaurant's complete profile
router.get('/restaurant/:restaurantId', protect, async (req, res) => {
  try {
    const resId = Number(req.params.restaurantId);
    
    // Auth check
    if (req.user.role === 'owner' && req.user.restaurantId !== resId) {
       return res.status(403).json({ message: 'Access denied.' });
    }

    const restaurant = await Restaurant.findOne({ id: resId });
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }

    const bookings = await Booking.find({ restaurant: resId, status: { $in: ['Payment Verified', 'fulfilled'] } }).sort({ createdAt: -1 });
    const settlements = await Settlement.find({ partner: restaurant.name }).sort({ createdAt: -1 });

    let grossBilled = 0;
    let coverCharges = 0;
    let commissionOwed = 0;
    let commissionPaid = 0;
    let pendingCommission = 0;

    bookings.forEach(b => {
      const billINR = (b.bill_amount || 0) / 100;
      const coverINR = (b.cover_charge || 0) / 100;
      const commINR = (b.commission_amount || 0) / 100;
      
      grossBilled += billINR;
      coverCharges += coverINR;
      commissionOwed += commINR;
      
      if (b.settlement_status === 'Settled') {
        commissionPaid += commINR;
      } else {
        pendingCommission += commINR;
      }
    });

    res.json({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        cuisine: restaurant.cuisine,
        city: restaurant.city,
        rating: restaurant.rating,
        commission_percentage: restaurant.commission_percentage || 5
      },
      stats: {
        totalBookings: bookings.length,
        grossBilled,
        coverCharges,
        commissionOwed,
        commissionPaid,
        pendingCommission,
        status: pendingCommission === 0 && commissionPaid > 0 ? 'Paid' : (pendingCommission > 0 && commissionPaid > 0 ? 'Partially Paid' : 'Pending')
      },
      bookings: bookings.map(t => ({
        id: t.id,
        customerName: t.guest,
        billAmount: (t.bill_amount || 0) / 100,
        coverCharge: (t.cover_charge || 0) / 100,
        commissionAmount: (t.commission_amount || 0) / 100,
        settlementStatus: t.settlement_status,
        date: t.transaction_date || t.createdAt,
      })),
      settlements
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/settlements/:id/partial-pay
// @desc    Mark bookings for a restaurant as paid (partial or full)
router.put('/:id/partial-pay', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: Admin authority required' });
  }

  try {
    const resId = Number(req.params.id);
    const { amountPaid, transactionReference } = req.body;
    
    // In this basic version, we just mark oldest pending bookings as settled until amountPaid is exhausted
    // Convert to paise for accurate tracking
    let amountRemainingPaise = Math.round(Number(amountPaid) * 100);

    const pendingBookings = await Booking.find({ 
      restaurant: resId, 
      status: { $in: ['Payment Verified', 'fulfilled'] },
      settlement_status: 'Pending'
    }).sort({ createdAt: 1 }); // oldest first

    let settledCount = 0;
    
    for (const b of pendingBookings) {
      if (amountRemainingPaise <= 0) break;
      
      const commAmount = b.commission_amount || 0;
      if (amountRemainingPaise >= commAmount) {
        b.settlement_status = 'Settled';
        // Note: we'd store transactionReference somewhere if schema supported it
        await b.save();
        amountRemainingPaise -= commAmount;
        settledCount++;
      } else {
        // Only partial paying a single booking isn't supported in simple schema, so we just stop
        break; 
      }
    }

    res.json({ success: true, message: `Marked ${settledCount} bookings as Settled.` });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
