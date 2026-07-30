const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const CoverCharge = require('../models/CoverCharge');
const { protect } = require('../middleware/authMiddleware');
const { syncCRM } = require('../middleware/crmHelper');
const nodemailer = require('nodemailer');

// Helper to check if credentials are mock/default placeholders
const isMockMode = () => {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!keyId || !keySecret) return true;
  if (keyId === 'rzp_test_mockkey123' || keyId.includes('yourkeyhere')) return true;
  if (keySecret === 'mocksecret123' || keySecret.includes('yourkeyhere')) return true;
  return false;
};

// Initialize Razorpay SDK
let razorpay = null;
try {
  if (!isMockMode()) {
    razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('[Razorpay] SDK initialized in LIVE TEST mode with key:', process.env.RAZORPAY_KEY_ID);
  } else {
    console.log('[Razorpay] Running in MOCK/SANDBOX mode (no real credentials)');
  }
} catch (error) {
  console.error('[Razorpay] Failed to initialize SDK:', error);
}

// Nodemailer setup for booking emails
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

router.post('/create-order', async (req, res) => {
  let { restaurantId, guests, guest, time, guest_email, bill_amount, cover_charge, amount, bookingId, is_booking_payment } = req.body;

  if (!restaurantId || !guests || !time) {
    return res.status(400).json({ error: 'Missing mandatory fields: restaurantId, guests, and time are required' });
  }

  try {
    // 1. Get Restaurant details
    const restaurant = await Restaurant.findOne({ id: Number(restaurantId) });
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurant not found' });
    }

    let booking = null;
    let orderId = `order_mock_${Math.random().toString(36).substring(2, 12)}`;
    let totalAmountInPaise = 5100; // default
    let commissionPercent = restaurant.commission_percentage || 5;

    // Convert bookingId if it has prefix (e.g. DHB-15)
    let numericBookingId = null;
    if (bookingId) {
      numericBookingId = Number(String(bookingId).replace('DHB-', ''));
      booking = await Booking.findOne({ id: numericBookingId });
    }

    const billAmountInPaise = Number(bill_amount) || 0;
    const coverChargeInPaise = Number(cover_charge) || Number(amount) || 0;
    const commissionAmountInPaise = Math.round((billAmountInPaise * commissionPercent) / 100);

    if (booking) {
      // It is an update for an existing booking (e.g. paying final bill at restaurant)
      // Remaining payable amount = bill_amount - booking.cover_charge
      const remainingAmountInPaise = billAmountInPaise - (booking.cover_charge || 0);
      totalAmountInPaise = remainingAmountInPaise > 0 ? remainingAmountInPaise : 100; // min 1 rupee (100 paise)

      // Generate Razorpay Order
      if (!isMockMode() && razorpay) {
        console.log(`[Razorpay] Creating bill order: amount=${totalAmountInPaise} paise`);
        const razorpayOrder = await razorpay.orders.create({
          amount: totalAmountInPaise,
          currency: 'INR',
          receipt: `receipt_bill_${booking.id}`
        });
        orderId = razorpayOrder.id;
      }

      // Update the existing booking with bill details
      booking.razorpay_order_id = orderId;
      booking.bill_amount = billAmountInPaise;
      booking.commission_amount = commissionAmountInPaise;
      booking.amount = totalAmountInPaise; // this represents the transaction amount to be paid now
      booking.status = 'Payment Pending';
      booking.payment_status = 'Bill Pending';
      await booking.save();
    } else {
      // It is a new booking (either walk-in payment or new slot reservation)
      // Determine Next Booking ID
      const lastBooking = await Booking.findOne().sort({ id: -1 });
      const nextId = lastBooking ? lastBooking.id + 1 : 1;

      if (is_booking_payment) {
        // Slot booking payment: they only pay the cover charge now!
        totalAmountInPaise = coverChargeInPaise > 0 ? coverChargeInPaise : 5000; // default ₹50
      } else {
        // Walk-in payment: they pay bill_amount + cover_charge
        const rawTotal = billAmountInPaise + coverChargeInPaise;
        totalAmountInPaise = rawTotal > 0 ? rawTotal : 5100;
      }

      // Generate Razorpay Order
      if (!isMockMode() && razorpay) {
        console.log(`[Razorpay] Creating new order: amount=${totalAmountInPaise} paise`);
        const razorpayOrder = await razorpay.orders.create({
          amount: totalAmountInPaise,
          currency: 'INR',
          receipt: `receipt_booking_${nextId}`
        });
        orderId = razorpayOrder.id;
      }

      // Create Booking in 'Payment Pending' state
      booking = await Booking.create({
        id: nextId,
        restaurant: restaurant.id,
        restaurant_name: restaurant.name,
        restaurant_image: restaurant.image_url,
        booking_time: time,
        guests: Number(guests),
        guest: guest || 'Anonymous Diner',
        guest_email: guest_email || '',
        razorpay_order_id: orderId,
        status: 'Payment Pending',
        amount: totalAmountInPaise,
        bill_amount: billAmountInPaise,
        cover_charge: is_booking_payment ? totalAmountInPaise : coverChargeInPaise,
        commission_percentage: commissionPercent,
        commission_amount: commissionAmountInPaise,
        payment_status: 'Pending',
        settlement_status: 'Pending'
      });
    }

    const checkoutUrl = `${req.protocol}://${req.get('host')}/api/payments/checkout/${orderId}`;

    return res.status(201).json({
      success: true,
      message: 'Payment order created successfully',
      booking,
      orderId,
      amount: totalAmountInPaise,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey123',
      checkoutUrl
    });
  } catch (error) {
    console.error('Failed to create payment order:', error);
    return res.status(500).json({ error: 'Failed to create payment order', details: error.message });
  }
});

// @route   GET /api/payment/checkout/:orderId
// @desc    Serves the hosted HTML payment checkout page (loads official SDK or Sandbox UI)
router.get('/checkout/:orderId', async (req, res) => {
  try {
    const booking = await Booking.findOne({ razorpay_order_id: req.params.orderId });
    if (!booking) {
      return res.status(404).send('Booking or Order ID not found');
    }

    const isMock = isMockMode();
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey123';

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Dine Hub Secure Checkout</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          :root {
            --primary: #FC8019;
            --primary-dark: #e06d10;
            --bg: #FFFBF8;
            --card-bg: #ffffff;
            --text-main: #111827;
            --text-muted: #4B5563;
            --border: #FFD8BA;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
          }
          .card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 20px;
            padding: 24px;
            max-width: 420px;
            width: 100%;
            box-shadow: 0 10px 30px rgba(252, 128, 25, 0.06);
            box-sizing: border-box;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
          }
          .brand-icon {
            font-size: 36px;
            margin-bottom: 6px;
            display: inline-block;
          }
          h2 { color: var(--text-main); margin: 0 0 6px 0; font-size: 20px; font-weight: 800; }
          .subtitle { color: var(--text-muted); font-size: 13px; margin: 0; }
          
          .amount-box {
            background: #FFF5EC;
            border: 1px solid #FFD8BA;
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .amount-label { font-size: 13px; color: var(--text-muted); font-weight: 500; }
          .amount-val { font-size: 22px; color: var(--primary); font-weight: 800; }

          .section-title {
            font-size: 11px;
            font-weight: 700;
            color: #9CA3AF;
            text-transform: uppercase;
            letter-spacing: 0.75px;
            margin-bottom: 10px;
            text-align: left;
          }

          .options-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 20px;
          }

          .pay-opt-btn {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            border-radius: 12px;
            border: 1.5px solid #E5E7EB;
            background: white;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            color: var(--text-main);
            transition: all 0.2s ease;
            text-align: left;
            width: 100%;
            box-sizing: border-box;
          }
          .pay-opt-btn:hover {
            border-color: var(--primary);
            background: #FFFBF8;
            transform: translateY(-1px);
          }
          .pay-opt-btn:active {
            transform: translateY(0);
          }
          .brand-logo-container {
            width: 32px;
            height: 32px;
            margin-right: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }

          .badge-sandbox {
            background: #FFF5EC;
            color: var(--primary);
            font-size: 10px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 20px;
            display: inline-block;
            margin-bottom: 10px;
            border: 1px solid #FFD8BA;
          }

          .loader {
            border: 4px solid #FFF5EC;
            border-top: 4px solid var(--primary);
            border-radius: 50%;
            width: 36px;
            height: 36px;
            animation: spin 0.8s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

          .details-table {
            width: 100%;
            font-size: 12px;
            margin-bottom: 14px;
            border-collapse: collapse;
            text-align: left;
          }
          .details-table td {
            padding: 4px 0;
          }
        </style>
      </head>
      <body>
        <div class="card" id="payment-card">
          <div class="header">
            ${isMock ? '<span class="badge-sandbox">RAZORPAY SANDBOX (MOCK MODE)</span><br>' : ''}
            <span class="brand-icon">🍴</span>
            <h2>Dine Hub Secure Checkout</h2>
            <p class="subtitle">Confirming reservation at <strong>${booking.restaurant_name}</strong></p>
          </div>

          <table class="details-table">
            ${ booking.cover_charge > 0 ? `<tr><td style="color:#6B7280;">Cover Charge:</td><td style="text-align:right;font-weight:600;">₹${(booking.cover_charge/100).toFixed(2)}</td></tr>` : '' }
            ${ booking.bill_amount > 0 ? `<tr><td style="color:#6B7280;">Restaurant Bill:</td><td style="text-align:right;font-weight:600;">₹${(booking.bill_amount/100).toFixed(2)}</td></tr>` : '' }
          </table>

          <div class="amount-box">
            <span class="amount-label">Total Amount:</span>
            <span class="amount-val">₹${(booking.amount/100).toFixed(2)}</span>
          </div>

          <div class="section-title">Select Payment Option</div>
          
          <div class="options-list">
            <!-- Google Pay (UPI) -->
            <button class="pay-opt-btn" onclick="payWithRazorpay('upi')">
              <div class="brand-logo-container">
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
                  <rect width="40" height="40" rx="8" fill="#F1F3F4"/>
                  <path d="M25.7 18.3h-5.2v2.4h3.7c-.3 1.5-1.6 2.6-3.7 2.6-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5c1.1 0 2.1.4 2.9 1.1l1.8-1.8c-1.2-1.1-2.8-1.8-4.7-1.8-3.9 0-7 3.1-7 7s3.1 7 7 7c4.1 0 6.8-2.9 6.8-6.9 0-.4 0-.8-.1-1.1z" fill="#4285F4"/>
                  <path d="M12.5 20c0-.9.2-1.7.5-2.5l-4-3.1c-.8 1.7-1.3 3.6-1.3 5.6s.5 3.9 1.3 5.6l4-3.1c-.3-.8-.5-1.6-.5-2.5z" fill="#FBBC05"/>
                  <path d="M21 13.5c1.9 0 3.5.7 4.7 1.8l1.8-1.8c-2.4-2.2-5.4-3.5-8.5-3.5-5.2 0-9.6 3.1-11.5 7.6l4 3.1c.9-2.7 3.5-4.7 6.5-4.7z" fill="#EA4335"/>
                  <path d="M21 26.5c3 0 5.6-2 6.5-4.7l-4-3.1c-.9 2.7-3.5 4.7-6.5 4.7-1.9 0-3.5-.7-4.7-1.8l-1.8 1.8c2.4 2.2 5.4 3.5 8.5 3.5z" fill="#34A853"/>
                </svg>
              </div>
              <div>
                <div style="font-weight:700">Google Pay</div>
                <div style="font-size:11px;color:#9CA3AF;font-weight:normal">Instant verification via UPI</div>
              </div>
            </button>

            <!-- PhonePe (UPI) -->
            <button class="pay-opt-btn" onclick="payWithRazorpay('upi')">
              <div class="brand-logo-container">
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
                  <rect width="40" height="40" rx="8" fill="#5F259F"/>
                  <path d="M19 14h-3.5v7h3.5c1 0 1.8-.8 1.8-1.8v-3.4c0-1-.8-1.8-1.8-1.8zm-.2 4.5h-1.3v-2h1.3c.4 0 .8.2 1 .5s.3.7.3 1-.1.7-.3 1c-.2.3-.6.5-1 .5z" fill="#ffffff"/>
                  <path d="M25 14h-3.5v12H25V14z" fill="#ffffff"/>
                </svg>
              </div>
              <div>
                <div style="font-weight:700">PhonePe</div>
                <div style="font-size:11px;color:#9CA3AF;font-weight:normal">Pay using PhonePe UPI App</div>
              </div>
            </button>

            <!-- Paytm UPI -->
            <button class="pay-opt-btn" onclick="payWithRazorpay('upi')">
              <div class="brand-logo-container">
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
                  <rect width="40" height="40" rx="8" fill="#00baf2"/>
                  <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="10" fill="#ffffff">paytm</text>
                </svg>
              </div>
              <div>
                <div style="font-weight:700">Paytm UPI</div>
                <div style="font-size:11px;color:#9CA3AF;font-weight:normal">UPI payment using Paytm</div>
              </div>
            </button>

            <!-- Cards / Netbanking / Wallets -->
            <button class="pay-opt-btn razorpay-btn" onclick="payWithRazorpay()">
              <div class="brand-logo-container">
                <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%">
                  <rect width="40" height="40" rx="8" fill="#3399CC"/>
                  <path d="M12 16h16v10H12V16zm2 2h12v6H14v-6z" fill="#ffffff"/>
                  <circle cx="17" cy="20" r="1.5" fill="#ffffff"/>
                  <circle cx="21" cy="20" r="1.5" fill="#ffffff"/>
                </svg>
              </div>
              <div>
                <div style="font-weight:700;color:#0B3C5D">Cards / Netbanking / Wallets</div>
                <div style="font-size:11px;color:#3399CC;font-weight:normal">${isMock ? 'Simulated Razorpay Checkout' : 'Secure Checkout via Razorpay'}</div>
              </div>
            </button>
          </div>

          <p style="font-size:11px;color:#9CA3AF;margin:12px 0 0 0;text-align:center;">Secure SSL Encrypted Transactions</p>
        </div>

        <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        <script>
          // Razorpay Gateway Flow
          function payWithRazorpay(method) {
            if (${isMock}) {
              // Simulated Razorpay Checkout in Mock Mode
              var card = document.getElementById('payment-card');
              card.innerHTML = '<div class="loader"></div><h2 style="margin-top:12px">Simulating Razorpay Checkout…</h2><p>Please wait while we establish a secure session.</p>';
              setTimeout(function() {
                var form = document.createElement('form');
                form.method = 'POST';
                form.action = '/api/payments/verify';
                var inputs = {
                  razorpay_payment_id: 'pay_mock_' + Math.random().toString(36).substring(2, 12),
                  razorpay_order_id: '${booking.razorpay_order_id}',
                  razorpay_signature: 'mock_signature_verified'
                };
                for (var key in inputs) {
                  var inp = document.createElement('input');
                  inp.type = 'hidden'; inp.name = key; inp.value = inputs[key];
                  form.appendChild(inp);
                }
                document.body.appendChild(form);
                form.submit();
              }, 1500);
              return;
            }
 
            // Real/Test Razorpay Checkout
            var options = {
              key: "${razorpayKeyId}",
              amount: ${booking.amount},
              currency: "INR",
              name: "Dine Hub",
              description: "Table Reservation — ${booking.restaurant_name}",
              order_id: "${booking.razorpay_order_id}",
              handler: function(response) {
                var card = document.getElementById('payment-card');
                card.innerHTML = '<div class="loader"></div><h2 style="margin-top:12px">Verifying payment…</h2><p>Please do not close this window.</p>';
                var form = document.createElement('form');
                form.method = 'POST';
                form.action = '/api/payments/verify';
                ['razorpay_payment_id','razorpay_order_id','razorpay_signature'].forEach(function(k) {
                  var inp = document.createElement('input');
                  inp.type = 'hidden'; inp.name = k; inp.value = response[k];
                  form.appendChild(inp);
                });
                document.body.appendChild(form);
                form.submit();
              },
              prefill: {
                name: "${booking.guest}",
                email: "${booking.guest_email || ''}",
                method: method || undefined
              },
              notes: {
                restaurant: "${booking.restaurant_name}",
                booking_time: "${booking.booking_time}"
              },
              theme: { color: "#FC8019" }
            };

            var rzp = new Razorpay(options);
            rzp.on('payment.failed', function(resp) {
              alert('Payment failed: ' + resp.error.description);
            });
            rzp.open();
          }
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Failed to render checkout view:', error);
    return res.status(500).send('Checkout rendering failed: ' + error.message);
  }
});

// @route   POST /api/payment/verify
// @desc    Verifies Razorpay payment signature, confirms booking, triggers emails
router.post('/verify', async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  try {
    // 1. Fetch related booking
    const booking = await Booking.findOne({ razorpay_order_id });
    if (!booking) {
      return res.status(404).send('Booking details not found for order: ' + razorpay_order_id);
    }

    // 2. Perform payment verification
    let verified = false;
    if (isMockMode() || razorpay_signature === 'mock_signature_verified') {
      verified = razorpay_signature === 'mock_signature_verified';
    } else {
      const generatedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(razorpay_order_id + '|' + razorpay_payment_id)
        .digest('hex');
      verified = generatedSignature === razorpay_signature;
    }

    if (!verified) {
      booking.status = 'cancelled';
      await booking.save();
      return res.redirect('/api/payments/failure');
    }

    // 3. Mark booking as paid/completed
    const isNewBookingPayment = booking.payment_status === 'Pending';
    if (!booking.timeline) booking.timeline = [];
    if (booking.payment_status === 'Bill Pending') {
      booking.status = 'fulfilled';
      booking.payment_status = 'Bill Paid';
      booking.timeline.push({
        timestamp: new Date(),
        user: 'Customer',
        status: 'fulfilled',
        event_details: 'Final dining bill paid. Settlement generated.'
      });
    } else {
      booking.status = 'Payment Verified';
      booking.payment_status = 'Paid';
      booking.timeline.push({
        timestamp: new Date(),
        user: 'Customer',
        status: 'Payment Verified',
        event_details: 'Cover charge payment verified, reservation confirmed.'
      });
    }
    booking.transaction_date = new Date();
    booking.razorpay_payment_id = razorpay_payment_id;
    await booking.save();

    // Create Cover Charge record if it was the initial booking payment
    if (isNewBookingPayment) {
      try {
        const coverChargeId = `CC-${Math.floor(100000 + Math.random() * 900000)}`;
        await CoverCharge.create({
          id: coverChargeId,
          booking_id: booking.id,
          customer_name: booking.guest,
          customer_phone: booking.guest_phone || `+91 ${Math.floor(6000000000 + Math.random() * 4000000000)}`,
          restaurant_name: booking.restaurant_name,
          guests: booking.guests,
          amount: booking.cover_charge || booking.amount,
          payment_status: 'Paid',
          transaction_id: razorpay_payment_id,
          payment_gateway: 'Razorpay',
          payment_time: new Date(),
          refund_status: 'None',
          reservation_status: booking.status
        });
      } catch (ccError) {
        console.error('Failed to create Cover Charge record:', ccError);
      }
    }

    // Sync CRM
    try {
      await syncCRM(booking);
    } catch (crmError) {
      console.error('Failed to sync CRM after payment:', crmError);
    }

    // 3.1 Update Restaurant stats (revenue + pending_commission)
    const restaurantObj = await Restaurant.findOne({ id: booking.restaurant });
    if (restaurantObj) {
      restaurantObj.revenue = (restaurantObj.revenue || 0) + (booking.bill_amount / 100);
      restaurantObj.pending_commission = (restaurantObj.pending_commission || 0) + booking.commission_amount;
      await restaurantObj.save();
    }

    // 4. Send Confirmation Emails in Background
    try {
      const restaurant = await Restaurant.findOne({ id: booking.restaurant });
      const ownerUser = await User.findOne({ role: 'owner', restaurantId: booking.restaurant });
      const admins = await User.find({ role: 'admin' });
      const adminEmails = admins.map(a => a.email);

      const staffRecipients = [];
      if (ownerUser && ownerUser.email) staffRecipients.push(ownerUser.email);
      adminEmails.forEach(e => {
        if (e && !staffRecipients.includes(e)) staffRecipients.push(e);
      });

      // B2C Customer Confirmation Email
      if (booking.guest_email && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const guestMailOptions = {
          from: `"Dine Hub Booking" <${process.env.SMTP_USER}>`,
          to: booking.guest_email,
          subject: `Dine Hub: Booking Confirmed at ${booking.restaurant_name}! 🍽️`,
          text: `Hello ${booking.guest},\n\nThanks for booking! Your table reservation at ${booking.restaurant_name} is confirmed and payment of ₹${(booking.amount / 100).toFixed(2)} was verified.\n\nPayment Split Details:\n- Total Amount Paid: ₹${(booking.amount / 100).toFixed(2)}\n- Dine Hub Cover Charge (direct credit): ₹${(booking.cover_charge / 100).toFixed(2)}\n- Restaurant Bill (transferred to restaurant): ₹${(booking.bill_amount / 100).toFixed(2)}\n\nReservation Details:\n- Restaurant: ${booking.restaurant_name}\n- Date & Time: ${booking.booking_time}\n- Guests: ${booking.guests} Guests\n\nWe look forward to hosting you!\n\nHappy Dining,\nThe Dine Hub Team`,
          html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
              <h2 style="color: #FC8019; text-align: center; margin-bottom: 20px;">Booking Confirmed! 🎉</h2>
              <p>Hello <strong>${booking.guest}</strong>,</p>
              <p>Thanks for booking! Your table reservation is confirmed. A total payment of <strong>₹${(booking.amount / 100).toFixed(2)}</strong> was verified successfully.</p>
              
              <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #111827; font-size: 15px;">Payment Split Details:</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <tr>
                    <td style="padding: 6px 0; color: #4B5563;">Dine Hub Cover Charge (direct credit):</td>
                    <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #111;">₹${(booking.cover_charge / 100).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; color: #4B5563;">Restaurant Bill (100% to restaurant):</td>
                    <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #111;">₹${(booking.bill_amount / 100).toFixed(2)}</td>
                  </tr>
                  <tr style="border-top: 1px solid #E5E7EB;">
                    <td style="padding: 8px 0; font-weight: bold; color: #111827; width: 150px;">Total Paid:</td>
                    <td style="padding: 8px 0; font-weight: bold; text-align: right; color: #FC8019; font-size: 16px;">₹${(booking.amount / 100).toFixed(2)}</td>
                  </tr>
                </table>
              </div>
              
              <div style="background-color: #FFF5EC; border: 1px solid #FFD8BA; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #7C2D12; font-size: 15px;">Reservation Details:</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; width: 120px; color: #666;">Restaurant:</td>
                    <td style="padding: 6px 0; font-weight: bold; color: #111;">${booking.restaurant_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Date & Time:</td>
                    <td style="padding: 6px 0; color: #FC8019; font-weight: bold;">${booking.booking_time}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Guests:</td>
                    <td style="padding: 6px 0; color: #111;">${booking.guests} Guests</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Payment ID:</td>
                    <td style="padding: 6px 0; font-family: monospace; color: #111;">${razorpay_payment_id}</td>
                  </tr>
                </table>
              </div>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 12px; color: #999; text-align: center;">Happy Dining,<br/>The Dine Hub Team</p>
            </div>
          `
        };
        transporter.sendMail(guestMailOptions, (err) => {
          if (err) console.error('Failed to email customer booking receipt:', err);
        });
      }

      // B2B Staff Booking Notification Email
      if (staffRecipients.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const staffMailOptions = {
          from: `"Dine Hub Booking Alerts" <${process.env.SMTP_USER}>`,
          to: staffRecipients.join(', '),
          subject: `[Dine Hub] New Booking Alert (Paid): ${booking.restaurant_name}`,
          text: `A new reservation (Paid) has been confirmed:\n\n- Restaurant: ${booking.restaurant_name}\n- Customer: ${booking.guest}\n- Email: ${booking.guest_email || 'Not Provided'}\n- Time: ${booking.booking_time}\n- Guests: ${booking.guests}\n- Payment ID: ${razorpay_payment_id}\n\nOpen the Admin Console for details.`,
          html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
              <h2 style="color: #FC8019; text-align: center;">Paid Reservation Confirmed! 🛎️</h2>
              <p>A new reservation with verified payment has been confirmed on Dine Hub:</p>
              
              <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; width: 140px; color: #666;">Restaurant:</td>
                    <td style="padding: 6px 0; font-weight: bold; color: #111;">${booking.restaurant_name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Customer Name:</td>
                    <td style="padding: 6px 0; color: #111; font-weight: 600;">${booking.guest}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Customer Email:</td>
                    <td style="padding: 6px 0; color: #111;">${booking.guest_email || 'Not Provided'}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Reservation Time:</td>
                    <td style="padding: 6px 0; color: #FC8019; font-weight: bold;">${booking.booking_time}</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Guests:</td>
                    <td style="padding: 6px 0; color: #111;">${booking.guests} Guests</td>
                  </tr>
                  <tr>
                    <td style="padding: 6px 0; font-weight: bold; color: #666;">Payment ID:</td>
                    <td style="padding: 6px 0; font-family: monospace; color: #111;">${razorpay_payment_id}</td>
                  </tr>
                </table>
              </div>
            </div>
          `
        };
        transporter.sendMail(staffMailOptions, (err) => {
          if (err) console.error('Failed to notify staff of booking:', err);
        });
      }
    } catch (mailErr) {
      console.error('Failed to process post-payment emails:', mailErr);
    }

    return res.redirect(`/api/payments/success?bookingId=${booking.id}`);
  } catch (error) {
    console.error('Verification route failed:', error);
    return res.status(500).send('Payment verification failed: ' + error.message);
  }
});

// @route   GET /api/payments/status/:orderId
// @desc    Retrieve the payment/booking status by Order ID
router.get('/status/:orderId', async (req, res) => {
  try {
    const booking = await Booking.findOne({ razorpay_order_id: req.params.orderId });
    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }
    return res.json({ success: true, status: booking.status });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// @route   GET /api/payment/success
// @desc    Renders a premium hosted success screen
router.get('/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          background: #FFFBF8;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .card {
          background: white;
          border: 1px solid #FFD8BA;
          border-radius: 16px;
          padding: 30px;
          max-width: 400px;
          width: 100%;
          box-shadow: 0 10px 25px rgba(252, 128, 25, 0.05);
          text-align: center;
        }
        .check-icon {
          font-size: 48px;
          color: #10B981;
          margin-bottom: 15px;
        }
        h2 { color: #111827; margin: 0 0 10px 0; }
        p { color: #4B5563; font-size: 14px; line-height: 1.5; margin: 0 0 20px 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="check-icon">✓</div>
        <h2>Payment Successful!</h2>
        <p>Your table reservation has been confirmed. You can now close this window and return to the Dine Hub app.</p>
      </div>
    </body>
    </html>
  `);
});

// @route   GET /api/payment/failure
// @desc    Renders a premium hosted failure screen
router.get('/failure', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          background: #FFFBF8;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .card {
          background: white;
          border: 1px solid #FCA5A5;
          border-radius: 16px;
          padding: 30px;
          max-width: 400px;
          width: 100%;
          box-shadow: 0 10px 25px rgba(239, 68, 68, 0.05);
          text-align: center;
        }
        .error-icon {
          font-size: 48px;
          color: #EF4444;
          margin-bottom: 15px;
        }
        h2 { color: #111827; margin: 0 0 10px 0; }
        p { color: #4B5563; font-size: 14px; line-height: 1.5; margin: 0 0 20px 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="error-icon">✕</div>
        <h2>Payment Cancelled</h2>
        <p>The transaction was cancelled or verification failed. You may close this window and try booking again.</p>
      </div>
    </body>
    </html>
  `);
});

// @route   GET /api/payments/cover-charges
// @desc    Get all cover charges (Super Admin only)
router.get('/cover-charges', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: Super Admin authorization required' });
  }
  try {
    const charges = await CoverCharge.find({}).sort({ createdAt: -1 });
    res.status(200).json(charges);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
