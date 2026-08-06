const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const nodemailer = require('nodemailer');
const { protect } = require('../middleware/authMiddleware');
const { syncCRM } = require('../middleware/crmHelper');

const FRONTEND_URL = process.env.FRONTEND_URL || "https://protraditional-joana-irruptively.ngrok-free.dev";

const https = require('https');

// Setup Nodemailer transporter
const nodemailerTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true for port 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Resend-aware transporter wrapper to bypass Render SMTP blocks
const transporter = {
  sendMail: (mailOptions, callback) => {
    if (process.env.RESEND_API_KEY) {
      console.log(`[Email] RESEND_API_KEY found. Sending email to ${mailOptions.to} via Resend HTTP API...`);
      let fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      
      const postData = JSON.stringify({
        from: `bookmydineout <${fromEmail}>`,
        to: mailOptions.to,
        subject: mailOptions.subject,
        text: mailOptions.text,
        html: mailOptions.html
      });

      const reqOptions = {
        hostname: 'api.resend.com',
        port: 443,
        path: '/emails',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(reqOptions, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Email] Email sent successfully via Resend to ${mailOptions.to}.`);
            if (callback) callback(null, { response: 'Resend HTTP 200 OK' });
          } else {
            console.error(`[Email] Resend HTTP Error ${res.statusCode}:`, body, "Falling back to Gmail SMTP...");
            nodemailerTransporter.sendMail(mailOptions, callback);
          }
        });
      });

      req.on('error', (e) => {
        console.error('[Email] Resend connection failed, falling back to Gmail SMTP:', e);
        nodemailerTransporter.sendMail(mailOptions, callback);
      });

      req.write(postData);
      req.end();
    } else {
      nodemailerTransporter.sendMail(mailOptions, callback);
    }
  }
};

// @route   GET /api/bookings
// @desc    Get all bookings (for Admin Console, filtered for owners)
router.get('/', protect, async (req, res) => {
  try {
    let query = { status: { $ne: 'Payment Pending' } };
    if (req.user.role === 'owner') {
      query = { status: { $ne: 'Payment Pending' }, restaurant: req.user.restaurantId };
    }
    const bookings = await Booking.find(query).sort({ createdAt: -1 });
    res.status(200).json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/bookings
// @desc    Create a booking (from Mobile App, public)
router.post('/', async (req, res) => {
  try {
    const { restaurant_id, time, guests, guest, guest_email } = req.body;

    // Find the restaurant details
    const restaurant = await Restaurant.findOne({ id: Number(restaurant_id) });
    if (!restaurant) {
      return res.status(404).json({ message: 'Restaurant not found' });
    }

    // Get max booking id to increment
    const maxBooking = await Booking.findOne().sort({ id: -1 });
    const nextId = maxBooking ? maxBooking.id + 1 : 5000;

    const guestName = guest || 'Aarav Shah';

    const now = new Date();
    const newBooking = await Booking.create({
      id: nextId,
      restaurant: restaurant.id,
      restaurant_name: restaurant.name,
      restaurant_image: restaurant.image_url,
      booking_time: time,
      guests: Number(guests),
      guest: guestName,
      status: 'upcoming',
      timeline: [
        { timestamp: new Date(now.getTime() - 15 * 60 * 1000), user: 'Customer', status: 'registered', event_details: 'Customer registered on DineHub app' },
        { timestamp: new Date(now.getTime() - 12 * 60 * 1000), user: 'Customer', status: 'login', event_details: 'Customer logged in to mobile app' },
        { timestamp: new Date(now.getTime() - 8 * 60 * 1000), user: 'Customer', status: 'viewed', event_details: `Restaurant details and menu viewed` },
        { timestamp: now, user: 'Customer', status: 'upcoming', event_details: 'Table reservation request created' }
      ]
    });

    // Track customer interaction for booking
    try {
      const Customer = require('../models/Customer');
      const Interaction = require('../models/Interaction');
      const emailVal = guest_email ? guest_email.toLowerCase() : '';
      let customer = null;
      if (emailVal) {
        customer = await Customer.findOne({ email: emailVal });
        if (!customer) {
          customer = await Customer.create({
            name: guestName,
            email: emailVal,
            phone_number: `+91 ${Math.floor(6000000000 + Math.random() * 4000000000)}`
          });
        }
      }
      if (customer) {
        await Interaction.create({
          customer: customer._id,
          restaurant_id: restaurant.id,
          interaction_type: 'booking'
        });
        console.log(`[CRM] Registered booking interaction for customer ${customer.email}`);
      }
    } catch (crmErr) {
      console.error('Failed to log CRM booking interaction:', crmErr);
    }

    // --- Retrieve Recipients for Booking Notification Emails ---
    try {
      const ownerUser = await User.findOne({ role: 'owner', restaurantId: restaurant.id });
      const admins = await User.find({ role: 'admin' });
      const adminEmails = admins.map(a => a.email);

      const staffRecipients = [];
      if (ownerUser && ownerUser.email) {
        staffRecipients.push(ownerUser.email);
      }
      adminEmails.forEach(email => {
        if (email && !staffRecipients.includes(email)) {
          staffRecipients.push(email);
        }
      });

      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        // 1. Send B2C Confirmation Email to Guest (if guest email exists)
        if (guest_email) {
          const guestMailOptions = {
            from: `"bookmydineout" <${process.env.SMTP_USER}>`,
            to: guest_email,
            subject: `Booking Confirmed! 🎉 Your reservation at ${restaurant.name} is all set.`,
            text: `Hello ${guestName},\n\nYour table reservation at ${restaurant.name} has been successfully confirmed. We look forward to hosting you!\n\nReservation Details:\n- Restaurant: ${restaurant.name}\n- Date & Time: ${time}\n- Guests: ${guests} Guests\n\nThank you for choosing bookmydineout.\n\nHappy Dining,\nThe bookmydineout Team`,
            html: `
              <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #F8FAFC; padding: 40px 20px; text-align: center;">
                <div style="max-width: 580px; margin: 0 auto; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); border: 1px solid #E2E8F0; text-align: left;">
                  <!-- Brand Header -->
                  <div style="background: linear-gradient(135deg, #FC8019 0%, #FF5722 100%); padding: 30px; text-align: center;">
                    <h1 style="color: #FFFFFF; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">Booking Confirmed! 🎉</h1>
                    <p style="color: rgba(255, 255, 255, 0.9); font-size: 14px; margin: 8px 0 0 0;">Your table at ${restaurant.name} is all set.</p>
                  </div>

                  <!-- Body -->
                  <div style="padding: 30px 40px;">
                    <p style="font-size: 16px; color: #1E293B; line-height: 1.5; margin: 0 0 20px 0;">Hello <strong>${guestName}</strong>,</p>
                    <p style="font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px 0;">
                      Great news! Your booking has been successfully confirmed at <strong>${restaurant.name}</strong>. We look forward to hosting you for an incredible dining experience!
                    </p>

                    <!-- Details Card -->
                    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px; margin: 0 0 24px 0;">
                      <h3 style="color: #0F172A; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0 0 16px 0; border-bottom: 1px solid #E2E8F0; padding-bottom: 8px;">
                        Reservation Details
                      </h3>
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr>
                          <td style="padding: 8px 0; font-weight: 600; color: #64748B; width: 120px;">Restaurant:</td>
                          <td style="padding: 8px 0; font-weight: 700; color: #0F172A;">${restaurant.name}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; font-weight: 600; color: #64748B;">Date & Time:</td>
                          <td style="padding: 8px 0; font-weight: 700; color: #FC8019;">${time}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; font-weight: 600; color: #64748B;">Guests:</td>
                          <td style="padding: 8px 0; color: #0F172A; font-weight: 600;">${guests} Guests</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; font-weight: 600; color: #64748B;">Payment:</td>
                          <td style="padding: 8px 0; color: #475569; font-weight: 600;">Pay at Restaurant</td>
                        </tr>
                      </table>
                    </div>

                    <div style="text-align: center; margin: 30px 0 10px 0;">
                      <p style="font-size: 14px; color: #64748B; line-height: 1.5; margin: 0;">
                        Need to make changes? Open the <strong>Dine Hub</strong> app to manage your reservations.
                      </p>
                    </div>
                  </div>

                  <!-- Footer -->
                  <div style="background-color: #F8FAFC; border-top: 1px solid #F1F5F9; padding: 24px 30px; text-align: center;">
                    <p style="font-size: 13px; color: #94A3B8; margin: 0;">
                      Thank you for choosing <strong>bookmydineout</strong>!
                    </p>
                    <p style="font-size: 12px; color: #94A3B8; margin: 4px 0 0 0;">
                      Happy Dining,<br/>The bookmydineout Team
                    </p>
                  </div>
                </div>
              </div>
            `
          };

          transporter.sendMail(guestMailOptions, (error, info) => {
            if (error) {
              console.error('Error sending guest booking confirmation email:', error);
            } else {
              console.log('Guest booking confirmation email sent successfully:', info.response);
            }
          });
        }

        // 2. Send B2B Notification Email to Restaurant Owner and Admins
        if (staffRecipients.length > 0) {
          const staffMailOptions = {
            from: `"Dine Hub Booking Alerts" <${process.env.SMTP_USER}>`,
            to: staffRecipients.join(', '),
            subject: `[Dine Hub] New Booking Alert: ${restaurant.name} - ${time}`,
            text: `A new reservation has been logged into the system:\n\n- Restaurant: ${restaurant.name}\n- Customer: ${guestName}\n- Email: ${guest_email || 'Not Provided'}\n- Time: ${time}\n- Guests: ${guests} Guests\n\nOpen the Admin Console for details.`,
            html: `
              <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
                <h2 style="color: #FC8019; text-align: center; margin-bottom: 20px;">New Booking Logged! 🛎️</h2>
                <p>A new table reservation is registered on Dine Hub:</p>
                
                <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 15px; margin: 20px 0;">
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                    <tr>
                      <td style="padding: 6px 0; font-weight: bold; width: 140px; color: #666;">Restaurant:</td>
                      <td style="padding: 6px 0; font-weight: bold; color: #111;">${restaurant.name}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; font-weight: bold; color: #666;">Customer Name:</td>
                      <td style="padding: 6px 0; color: #111; font-weight: 600;">${guestName}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; font-weight: bold; color: #666;">Customer Email:</td>
                      <td style="padding: 6px 0; color: #111;">${guest_email || 'Not Provided'}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; font-weight: bold; color: #666;">Reservation Time:</td>
                      <td style="padding: 6px 0; color: #FC8019; font-weight: bold;">${time}</td>
                    </tr>
                    <tr>
                      <td style="padding: 6px 0; font-weight: bold; color: #666;">Guests Count:</td>
                      <td style="padding: 6px 0; color: #111;">${guests} Guests</td>
                    </tr>
                  </table>
                </div>
                
                <div style="text-align: center; margin: 20px 0;">
                  <a href="${FRONTEND_URL}" style="background-color: #FC8019; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; font-size: 14px; display: inline-block;">
                    Open Admin Console
                  </a>
                </div>
              </div>
            `
          };

          transporter.sendMail(staffMailOptions, (error, info) => {
            if (error) {
              console.error('Error sending staff booking alert email:', error);
            } else {
              console.log('Staff booking alert email sent successfully:', info.response);
            }
          });
        }
      }
    } catch (mailError) {
      console.error('Failed to process booking notification email:', mailError);
    }

    res.status(201).json({
      status: 'success',
      message: 'Booking confirmed',
      booking: newBooking
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   PUT /api/bookings/:id
// @desc    Update a booking status (e.g., cancelled, seated)
router.put('/:id', protect, async (req, res) => {
  try {
    let booking;
    // Check if ID is numeric
    if (!isNaN(Number(req.params.id))) {
      booking = await Booking.findOne({ id: Number(req.params.id) });
    } else {
      booking = await Booking.findById(req.params.id);
    }

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Owner checks
    if (req.user.role === 'owner' && booking.restaurant !== req.user.restaurantId) {
      return res.status(403).json({ message: 'Access denied: you do not own this restaurant' });
    }

    // Update fields
    if (req.body.status) {
      const oldStatus = booking.status;
      booking.status = req.body.status;
      
      // Check for Check-in event
      if (req.body.status === 'seated' && oldStatus !== 'seated') {
        booking.check_in_time = new Date();
      }
      
      // Timeline logging
      if (!booking.timeline) booking.timeline = [];
      booking.timeline.push({
        timestamp: new Date(),
        user: req.user.role === 'admin' ? 'Super Admin' : 'Restaurant Partner',
        status: req.body.status,
        event_details: `Reservation status updated from "${oldStatus}" to "${req.body.status}"`
      });
    }
    
    if (req.body.guests) booking.guests = Number(req.body.guests);
    if (req.body.booking_time) booking.booking_time = req.body.booking_time;
    if (req.body.guest) booking.guest = req.body.guest;

    await booking.save();
    
    // Sync CRM
    try {
      await syncCRM(booking);
    } catch (crmErr) {
      console.error('CRM sync error on update status:', crmErr);
    }

    res.status(200).json(booking);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   POST /api/bookings/:id/cancel
// @desc    Cancel a booking from mobile client (public)
router.post('/:id/cancel', async (req, res) => {
  try {
    let booking;
    if (!isNaN(Number(req.params.id))) {
      booking = await Booking.findOne({ id: Number(req.params.id) });
    } else {
      booking = await Booking.findById(req.params.id);
    }

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    booking.status = 'cancelled';
    await booking.save();

    res.status(200).json({ success: true, message: 'Booking cancelled successfully', booking });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   POST /api/bookings/:id/complete
// @desc    Complete a booking from mobile client (public)
router.post('/:id/complete', async (req, res) => {
  try {
    let booking;
    if (!isNaN(Number(req.params.id))) {
      booking = await Booking.findOne({ id: Number(req.params.id) });
    } else {
      booking = await Booking.findById(req.params.id);
    }

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    booking.status = 'completed';
    await booking.save();

    res.status(200).json({ success: true, message: 'Booking completed successfully', booking });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   POST /api/bookings/:id/generate-bill
// @desc    Generate dining bill for a seated reservation (Restaurant Owner)
router.post('/:id/generate-bill', protect, async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ message: 'Access denied: Restaurant Owner authorization required' });
  }
  
  const { bill_number, subtotal, gst, offer_applied, coupon_used, discount, final_bill_amount, payment_method } = req.body;
  
  try {
    let booking;
    if (!isNaN(Number(req.params.id))) {
      booking = await Booking.findOne({ id: Number(req.params.id) });
    } else {
      booking = await Booking.findById(req.params.id);
    }
    
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    
    if (booking.restaurant !== req.user.restaurantId) {
      return res.status(403).json({ message: 'Access denied: You do not own this restaurant' });
    }
    
    // In database, amounts are stored in paise (cents): multiply by 100
    const subtotalPaise = Math.round(Number(subtotal) * 100);
    const gstPaise = Math.round(Number(gst) * 100);
    const discountPaise = Math.round(Number(discount) * 100);
    const finalBillPaise = Math.round(Number(final_bill_amount) * 100);
    
    // Calculate commission
    const commissionPercent = booking.commission_percentage || 5;
    const commissionAmountPaise = Math.round((finalBillPaise * commissionPercent) / 100);
    
    // Update booking fields
    booking.bill_number = bill_number || `BILL-${Math.floor(100000 + Math.random() * 900000)}`;
    booking.bill_amount = finalBillPaise;
    booking.gst = gstPaise;
    booking.offer_applied = offer_applied || '';
    booking.coupon_used = coupon_used || '';
    booking.discount = discountPaise;
    booking.net_bill = finalBillPaise;
    booking.payment_method = payment_method || 'Card';
    booking.commission_amount = commissionAmountPaise;
    booking.platform_commission = commissionAmountPaise;
    booking.restaurant_earnings = finalBillPaise - commissionAmountPaise;
    booking.billing_time = new Date();
    booking.status = 'fulfilled'; // Mark booking as fulfilled/billed
    booking.payment_status = payment_method === 'Cash' ? 'Bill Paid' : 'Paid'; // Cash is paid instantly, online handles checkout
    
    // Push events to timeline
    if (!booking.timeline) booking.timeline = [];
    booking.timeline.push({
      timestamp: new Date(),
      user: 'Restaurant Partner',
      status: 'seated',
      event_details: `Dining bill generated: #${booking.bill_number} (Subtotal: ₹${subtotal}, GST: ₹${gst}, Discount: ₹${discount}, Net: ₹${final_bill_amount})`
    });
    
    booking.timeline.push({
      timestamp: new Date(),
      user: 'System',
      status: 'fulfilled',
      event_details: `Platform commission calculated: ₹${(commissionAmountPaise/100).toFixed(2)} (${commissionPercent}%)`
    });

    await booking.save();
    
    // Update Restaurant revenue
    const Restaurant = require('../models/Restaurant');
    const restaurantObj = await Restaurant.findOne({ id: booking.restaurant });
    if (restaurantObj) {
      restaurantObj.revenue = (restaurantObj.revenue || 0) + (finalBillPaise / 100);
      restaurantObj.pending_commission = (restaurantObj.pending_commission || 0) + commissionAmountPaise;
      await restaurantObj.save();
    }
    
    // Sync CRM
    const { syncCRM } = require('../middleware/crmHelper');
    try {
      await syncCRM(booking);
    } catch (crmErr) {
      console.error('CRM sync error during billing:', crmErr);
    }
    
    res.status(200).json({ success: true, message: 'Bill generated and synced successfully', booking });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
