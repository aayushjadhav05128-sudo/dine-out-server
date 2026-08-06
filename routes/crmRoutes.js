const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Interaction = require('../models/Interaction');
const { protect } = require('../middleware/authMiddleware');
const nodemailer = require('nodemailer');
const https = require('https');

// Setup Nodemailer transporter
const nodemailerTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Unified transporter with fallback
const transporter = {
  sendMail: (mailOptions, callback) => {
    if (process.env.RESEND_API_KEY) {
      console.log(`[Email] RESEND_API_KEY found. Sending email to ${mailOptions.to} via Resend HTTP API...`);
      let fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
      
      const postData = JSON.stringify({
        from: `Dine Hub <${fromEmail}>`,
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

const sendMailPromise = (mailOptions) => {
  return new Promise((resolve, reject) => {
    transporter.sendMail(mailOptions, (err, info) => {
      if (err) reject(err);
      else resolve(info);
    });
  });
};

let etherealTransporter = null;
async function getEtherealTransporter() {
  if (etherealTransporter) return etherealTransporter;
  try {
    const testAccount = await nodemailer.createTestAccount();
    etherealTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log(`[Ethereal Email] Test account created: ${testAccount.user}`);
    return etherealTransporter;
  } catch (error) {
    console.error('Failed to create Ethereal account:', error);
    return null;
  }
}

// @route   POST /api/crm/track-interaction
// @desc    Saves user clicks & profile views (public tracking API)
router.post('/track-interaction', async (req, res) => {
  const { phoneNumber, userName, email, restaurantId, interactionType, instagramId, facebookId } = req.body;

  if (!phoneNumber || !restaurantId) {
    return res.status(400).json({ error: 'Missing mandatory fields: phoneNumber and restaurantId are required' });
  }

  try {
    // Find or create customer
    let customer = await Customer.findOne({ phone_number: phoneNumber });
    if (!customer) {
      customer = await Customer.create({
        name: userName || 'Anonymous Diner',
        phone_number: phoneNumber,
        email: email || '',
        instagram_id: instagramId || '',
        facebook_id: facebookId || '',
      });
    } else {
      let updated = false;
      if (userName && customer.name !== userName) {
        customer.name = userName;
        updated = true;
      }
      if (email && customer.email !== email) {
        customer.email = email;
        updated = true;
      }
      if (instagramId && customer.instagram_id !== instagramId) {
        customer.instagram_id = instagramId;
        updated = true;
      }
      if (facebookId && customer.facebook_id !== facebookId) {
        customer.facebook_id = facebookId;
        updated = true;
      }
      if (updated) {
        await customer.save();
      }
    }

    // Track behavioral interaction
    const interaction = await Interaction.create({
      customer: customer._id,
      restaurant_id: Number(restaurantId),
      interaction_type: interactionType || 'profile_view',
    });

    console.log(`[CRM] Tracked interaction: Customer ${customer.name} -> Restaurant ID: ${restaurantId}`);
    return res.status(201).json({
      success: true,
      message: 'Interaction logged in MongoDB successfully.',
      data: interaction,
    });
  } catch (error) {
    console.error('Error logging CRM interaction:', error);
    return res.status(500).json({ error: 'Database tracking error', details: error.message });
  }
});

// @route   GET /api/crm/customers
// @desc    Retrieve all unique customer details that have interacted with this specific restaurant (Owner/Admin)
router.get('/customers', protect, async (req, res) => {
  const { restaurantId } = req.query;

  if (!restaurantId) {
    return res.status(400).json({ error: 'restaurantId query parameter is required' });
  }

  // Owner check
  if (req.user.role === 'owner' && Number(restaurantId) !== req.user.restaurantId) {
    return res.status(403).json({ message: 'Access denied: you do not own this restaurant' });
  }

  try {
    const interactions = await Interaction.find({ restaurant_id: Number(restaurantId) })
      .populate('customer')
      .sort({ createdAt: -1 });

    const seen = new Set();
    const visitors = [];

    interactions.forEach(i => {
      if (i.customer && !seen.has(i.customer._id.toString())) {
        seen.add(i.customer._id.toString());
        visitors.push({
          user_id: i.customer._id,
          name: i.customer.name,
          phone_number: i.customer.phone_number,
          email: i.customer.email || '',
          instagram_id: i.customer.instagram_id || '',
          facebook_id: i.customer.facebook_id || '',
          last_interaction: i.createdAt,
          interaction_type: i.interaction_type,
        });
      }
    });

    return res.json({ success: true, data: visitors, count: visitors.length, mode: 'mongodb' });
  } catch (error) {
    console.error('Error fetching CRM customer logs:', error);
    return res.status(500).json({ error: 'Database fetch error', details: error.message });
  }
});

// @route   GET /api/crm/all-customers
// @desc    Admin-only: Retrieve ALL unique customers across all restaurants, with their latest login details
router.get('/all-customers', protect, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied: Admin authority required' });
  }

  try {
    // Get all customers sorted by most recently created
    const customers = await Customer.find({}).sort({ updatedAt: -1 });

    // Get the latest interaction for each customer
    const customerIds = customers.map(c => c._id);
    const latestInteractions = await Interaction.aggregate([
      { $match: { customer: { $in: customerIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$customer',
          last_interaction: { $first: '$createdAt' },
          interaction_type: { $first: '$interaction_type' },
          restaurant_id: { $first: '$restaurant_id' },
        }
      }
    ]);

    const interactionMap = {};
    latestInteractions.forEach(i => {
      interactionMap[i._id.toString()] = {
        last_interaction: i.last_interaction,
        interaction_type: i.interaction_type,
        restaurant_id: i.restaurant_id,
      };
    });

    const visitors = customers.map(c => ({
      user_id: c._id,
      name: c.name,
      phone_number: c.phone_number || '',
      email: c.email || '',
      instagram_id: c.instagram_id || '',
      facebook_id: c.facebook_id || '',
      last_interaction: interactionMap[c._id.toString()]?.last_interaction || c.createdAt,
      interaction_type: interactionMap[c._id.toString()]?.interaction_type || 'registered',
      restaurant_id: interactionMap[c._id.toString()]?.restaurant_id || null,
    }));

    return res.json({ success: true, data: visitors, count: visitors.length, mode: 'mongodb_all' });
  } catch (error) {
    console.error('Error fetching all CRM customers:', error);
    return res.status(500).json({ error: 'Database fetch error', details: error.message });
  }
});

// @route   POST /api/crm/broadcast
// @desc    Triggers the marketing message engine to send out the message text (Owner/Admin)
router.post('/broadcast', protect, async (req, res) => {
  const { restaurantId, offerText, channel } = req.body;

  if (!restaurantId || !offerText) {
    return res.status(400).json({ error: 'Missing parameter: restaurantId and offerText are required' });
  }

  const targetChannel = channel || 'all'; // 'all', 'whatsapp', 'instagram', 'messenger', 'sms'

  // Owner check
  if (req.user.role === 'owner' && Number(restaurantId) !== req.user.restaurantId) {
    return res.status(403).json({ message: 'Access denied: you do not own this restaurant' });
  }

  try {
    const Restaurant = require('../models/Restaurant');
    const restaurant = await Restaurant.findOne({ id: Number(restaurantId) });
    const restName = restaurant ? restaurant.name : 'Dine Hub';

    // 1. Fetch unique target customers
    const interactions = await Interaction.find({ restaurant_id: Number(restaurantId) }).populate('customer');
    if (interactions.length === 0) {
      return res.json({
        success: true,
        report: {
          recipientsProcessed: 0,
          successCount: 0,
          failureCount: 0,
          results: [],
        },
      });
    }

    const uniqueCustomersMap = new Map();
    interactions.forEach(i => {
      if (i.customer && i.customer.phone_number) {
        uniqueCustomersMap.set(i.customer._id.toString(), i.customer);
      }
    });

    const targetUsers = Array.from(uniqueCustomersMap.values());
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_SENDER_PHONE_NUMBER;

    const metaPageToken = process.env.META_PAGE_ACCESS_TOKEN;
    const metaPhoneId = process.env.META_WA_PHONE_NUMBER_ID;
    const metaWaToken = process.env.META_WA_ACCESS_TOKEN;
    const metaTemplate = process.env.META_WA_TEMPLATE_NAME || 'hello_world';

    const isPlaceholder = (val) => !val || val.includes('your_') || val.includes('ACXXX') || val.startsWith('https://your-');
    const isTwilioConfigured = !isPlaceholder(twilioSid) && !isPlaceholder(twilioToken) && !isPlaceholder(twilioFrom);
    const isMetaWaConfigured = !isPlaceholder(metaPhoneId) && !isPlaceholder(metaWaToken);
    const isMetaPageConfigured = !isPlaceholder(metaPageToken);

    for (const user of targetUsers) {
      const recipientPhone = user.phone_number;
      const recipientName = user.name;
      let primaryChannelSuccess = false;
      let usedChannel = 'none';
      let errorLog = null;

      // 1. WhatsApp Cloud API Sandbox
      if ((targetChannel === 'whatsapp' || targetChannel === 'all') && isMetaWaConfigured) {
        try {
          usedChannel = 'whatsapp';
          const waUrl = `https://graph.facebook.com/v19.0/${metaPhoneId}/messages`;
          const response = await fetch(waUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${metaWaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: recipientPhone,
              type: 'template',
              template: {
                name: metaTemplate,
                language: { code: 'en_US' }
              }
            }),
          });

          const data = await response.json();
          if (response.ok) {
            primaryChannelSuccess = true;
            console.log(`[WhatsApp API] Sent successfully to ${recipientPhone}`);
          } else {
            errorLog = JSON.stringify(data);
          }
        } catch (err) {
          errorLog = err.message;
        }
      }

      // 2. Instagram Direct Messages Send API
      if (!primaryChannelSuccess && (targetChannel === 'instagram' || targetChannel === 'all')) {
        if (user.instagram_id) {
          if (isMetaPageConfigured) {
            try {
              usedChannel = 'instagram';
              const igUrl = `https://graph.facebook.com/v19.0/me/messages`;
              const response = await fetch(igUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${metaPageToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  recipient: { id: user.instagram_id },
                  message: { text: `Hi ${recipientName}! ${offerText}` }
                })
              });
              const data = await response.json();
              if (response.ok) {
                primaryChannelSuccess = true;
                console.log(`[Instagram DM API] Sent successfully to ${user.instagram_id}`);
              } else {
                errorLog = JSON.stringify(data);
              }
            } catch (err) {
              errorLog = err.message;
            }
          } else {
            // Simulation mode for Instagram
            usedChannel = 'instagram_sandbox_simulation';
            primaryChannelSuccess = true;
            console.log(`[Instagram Simulation] DM sent to ${recipientName} (IGSID: ${user.instagram_id})`);
          }
        } else {
          errorLog = 'Diner has no linked Instagram ID';
        }
      }

      // 3. Facebook Messenger Send API
      if (!primaryChannelSuccess && (targetChannel === 'messenger' || targetChannel === 'all')) {
        if (user.facebook_id) {
          if (isMetaPageConfigured) {
            try {
              usedChannel = 'messenger';
              const fbUrl = `https://graph.facebook.com/v19.0/me/messages`;
              const response = await fetch(fbUrl, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${metaPageToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  recipient: { id: user.facebook_id },
                  message: { text: `Hi ${recipientName}! ${offerText}` }
                })
              });
              const data = await response.json();
              if (response.ok) {
                primaryChannelSuccess = true;
                console.log(`[Facebook Messenger API] Sent successfully to ${user.facebook_id}`);
              } else {
                errorLog = JSON.stringify(data);
              }
            } catch (err) {
              errorLog = err.message;
            }
          } else {
            // Simulation mode for Facebook Messenger
            usedChannel = 'messenger_sandbox_simulation';
            primaryChannelSuccess = true;
            console.log(`[Facebook Messenger Simulation] Message sent to ${recipientName} (FBID: ${user.facebook_id})`);
          }
        } else {
          errorLog = 'Diner has no linked Facebook ID';
        }
      }

      // 4. Twilio SMS Fallback
      if (!primaryChannelSuccess && (targetChannel === 'sms' || targetChannel === 'all') && isTwilioConfigured) {
        try {
          usedChannel = 'twilio_sms';
          const twilioClient = require('twilio')(twilioSid, twilioToken);
          const message = await twilioClient.messages.create({
            body: `Hi ${recipientName}! Special offer: ${offerText}`,
            from: twilioFrom,
            to: recipientPhone,
          });
          primaryChannelSuccess = true;
          console.log(`[SMS] Twilio message sent to ${recipientPhone}, message SID: ${message.sid}`);
        } catch (err) {
          errorLog = err.message;
        }
      }

      // Fallback sandbox simulation if Meta and Twilio are placeholders and scoped IDs exist
      if (!primaryChannelSuccess && !isMetaWaConfigured && !isTwilioConfigured && !isMetaPageConfigured) {
        
        // 5. Real Email Fallback via unified transporter
        if (user.email && (targetChannel === 'email' || targetChannel === 'all')) {
          try {
            let fromEmail = process.env.SMTP_USER || 'no-reply@dinehub.com';
            if (process.env.RESEND_API_KEY) {
              fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
            }
            await sendMailPromise({
              from: `Dine Hub <${fromEmail}>`,
              to: user.email,
              subject: `Special Offer from ${restName || 'Dine Hub'}! 🍽️`,
              text: `Hi ${recipientName}!\n\n${offerText}\n\nOpt-out of future updates by replying to this email.`,
              html: `
                <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
                  <h2 style="color: #FC8019;">Special Offer from ${restName || 'Dine Hub'}! 🍽️</h2>
                  <p>Hi <strong>${recipientName}</strong>,</p>
                  <p>${offerText}</p>
                  <hr style="border: 0; border-top: 1px solid #eee;" />
                  <p style="font-size: 11px; color: #999;">Opt-out of future updates from ${restName || 'Dine Hub'} by replying to this email.</p>
                </div>
              `
            });
            console.log(`[Email] CRM Broadcast sent successfully to ${user.email}.`);
            usedChannel = 'email';
            primaryChannelSuccess = true;
          } catch (err) {
            errorLog = err.message;
          }
        }

        if (!primaryChannelSuccess) {
          if (targetChannel === 'whatsapp' || targetChannel === 'all') {
            usedChannel = 'whatsapp_sandbox_simulation';
            primaryChannelSuccess = true;
          } else if (targetChannel === 'instagram') {
            if (user.instagram_id) {
              usedChannel = 'instagram_sandbox_simulation';
              primaryChannelSuccess = true;
            } else {
              errorLog = 'Diner has no linked Instagram ID';
            }
          } else if (targetChannel === 'messenger') {
            if (user.facebook_id) {
              usedChannel = 'messenger_sandbox_simulation';
              primaryChannelSuccess = true;
            } else {
              errorLog = 'Diner has no linked Facebook ID';
            }
          } else if (targetChannel === 'sms') {
            usedChannel = 'sms_sandbox_simulation';
            primaryChannelSuccess = true;
          }
        }
      }

      if (primaryChannelSuccess) {
        successCount++;
        results.push({
          userId: user._id,
          name: recipientName,
          phone: recipientPhone,
          channel: usedChannel,
          status: 'success',
        });
      } else {
        failureCount++;
        results.push({
          userId: user._id,
          name: recipientName,
          phone: recipientPhone,
          channel: usedChannel === 'none' ? targetChannel : usedChannel,
          status: 'failed',
          error: errorLog || 'Delivery channel failed or no identifier found',
        });
      }
    }

    return res.json({
      success: true,
      report: {
        recipientsProcessed: targetUsers.length,
        successCount,
        failureCount,
        results,
      },
    });

  } catch (error) {
    console.error('Error conducting broadcast blast:', error);
    return res.status(500).json({ error: 'Broadcast operation failed', details: error.message });
  }
});

// @route   POST /api/crm/login-event
// @desc    Register a customer login/registration in CRM for all restaurants (Public)
router.post('/login-event', async (req, res) => {
  const { name, email, phone } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'At least email or phone is required' });
  }

  try {
    let customer = null;

    // 1. Try to find existing customer
    if (phone) {
      customer = await Customer.findOne({ phone_number: phone });
    }
    if (!customer && email) {
      customer = await Customer.findOne({ email: email });
    }

    const customerData = {
      name: name || 'Anonymous Foodie',
      email: email || '',
    };
    if (phone) {
      customerData.phone_number = phone;
    }

    // 2. Create or update customer
    if (!customer) {
      customer = await Customer.create(customerData);
    } else {
      let updated = false;
      if (name && customer.name !== name) {
        customer.name = name;
        updated = true;
      }
      if (email && customer.email !== email) {
        customer.email = email;
        updated = true;
      }
      if (phone && customer.phone_number !== phone) {
        customer.phone_number = phone;
        updated = true;
      }
      // Always touch updatedAt so "last login" is accurate in the all-customers view
      customer.updatedAt = new Date();
      await customer.save();
    }

    // 3. Register 'login' interaction for ALL approved restaurants
    // Use findOneAndUpdate with upsert=true to always refresh the timestamp on each login
    const Restaurant = require('../models/Restaurant');
    const restaurants = await Restaurant.find({ status: 'approved' });

    for (const rest of restaurants) {
      await Interaction.findOneAndUpdate(
        {
          customer: customer._id,
          restaurant_id: rest.id,
          interaction_type: 'login',
        },
        {
          $set: {
            customer: customer._id,
            restaurant_id: rest.id,
            interaction_type: 'login',
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() }
        },
        { upsert: true, new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Login registered across CRM systems',
      customerId: customer._id,
    });
  } catch (error) {
    console.error('CRM login event tracking error:', error);
    return res.status(500).json({ error: 'CRM login tracking error', details: error.message });
  }
});

module.exports = router;
