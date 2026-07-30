const Customer = require('../models/Customer');
const Booking = require('../models/Booking');

/**
 * Recalculates and updates CRM analytics for a customer after a booking event.
 * @param {object} booking - The Booking mongoose document
 */
async function syncCRM(booking) {
  if (!booking) return;

  try {
    const email = booking.guest_email;
    const name = booking.guest;

    if (!email && !name) return;

    // Find customer by email or name
    let query = [];
    if (email) query.push({ email });
    if (name) query.push({ name });

    let customer = await Customer.findOne({ $or: query });

    if (!customer) {
      customer = new Customer({
        name: name || 'Anonymous Diner',
        email: email || '',
        phone_number: `+91 ${Math.floor(6000000000 + Math.random() * 4000000000)}` // Generate mock phone if missing
      });
    }

    // Fetch all bookings for this customer
    const bookingsQuery = [];
    if (email) bookingsQuery.push({ guest_email: email });
    if (name) bookingsQuery.push({ guest: name });
    const allBookings = await Booking.find({ $or: bookingsQuery });

    // Filter relevant categories
    const paidBookings = allBookings.filter(b => 
      b.payment_status === 'Paid' || 
      b.payment_status === 'Bill Paid' || 
      b.status === 'Payment Verified' || 
      b.status === 'fulfilled' || 
      b.status === 'seated'
    );

    const visitedBookings = allBookings.filter(b => 
      b.status === 'seated' || 
      b.status === 'fulfilled'
    );

    // Calculate aggregated values
    const totalVisits = visitedBookings.length;
    
    // Spend is in paise: sum of bill_amount (if billed) or cover_charge
    let lifetimeSpendPaise = 0;
    let offersRedeemed = 0;
    const restaurantCounts = {};

    visitedBookings.forEach(b => {
      lifetimeSpendPaise += (b.bill_amount || 0) + (b.cover_charge || 0);
      if (b.offer_applied || b.coupon_used) {
        offersRedeemed += 1;
      }
      if (b.restaurant_name) {
        restaurantCounts[b.restaurant_name] = (restaurantCounts[b.restaurant_name] || 0) + 1;
      }
    });

    const lifetimeSpendINR = lifetimeSpendPaise / 100;
    const averageBillINR = totalVisits > 0 ? (lifetimeSpendINR / totalVisits) : 0;

    // Determine favorite restaurants
    const favouriteRestaurants = Object.entries(restaurantCounts)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 3);

    // Find last visit
    let lastVisitDate = null;
    if (visitedBookings.length > 0) {
      const dates = visitedBookings
        .map(b => b.transaction_date || b.updatedAt)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      if (dates.length > 0) {
        lastVisitDate = dates[0];
      }
    }

    // Customer segmentation based on spend
    let customerSegment = 'Regular';
    if (lifetimeSpendINR >= 10000) {
      customerSegment = 'VVIP Platinum';
    } else if (lifetimeSpendINR >= 5000) {
      customerSegment = 'VIP Gold';
    } else if (lifetimeSpendINR >= 2000) {
      customerSegment = 'Silver Premium';
    }

    // Loyalty points: 1 point for every 10 INR spent
    const loyaltyPoints = Math.floor(lifetimeSpendINR / 10);

    // Update customer fields
    customer.totalVisits = totalVisits;
    customer.lifetimeSpend = lifetimeSpendINR;
    customer.averageBill = averageBillINR;
    customer.favouriteRestaurants = favouriteRestaurants;
    customer.offersRedeemed = offersRedeemed;
    if (lastVisitDate) customer.lastVisit = lastVisitDate;
    customer.customerSegment = customerSegment;
    customer.loyaltyPoints = loyaltyPoints;
    
    // Set a default cuisine if empty
    if (!customer.favouriteCuisine) {
      customer.favouriteCuisine = 'North Indian';
    }

    await customer.save();
    console.log(`[CRM Helper] Synced customer profiles for ${customer.name} (Spend: ₹${lifetimeSpendINR.toFixed(2)}, Visits: ${totalVisits})`);
  } catch (error) {
    console.error('[CRM Helper] Error syncing CRM data:', error);
  }
}

module.exports = {
  syncCRM
};
