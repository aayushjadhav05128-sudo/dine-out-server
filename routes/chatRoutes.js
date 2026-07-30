const express = require('express');
const router = express.Router();
const Restaurant = require('../models/Restaurant');
const Offer = require('../models/Offer');
const Customer = require('../models/Customer');
const Interaction = require('../models/Interaction');

// @route   POST /api/chat
// @desc    Handle chatbot queries
router.post('/', async (req, res) => {
  const { message, phoneNumber, userName, restaurantId } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // 1. CRM Tracking (if user info is provided)
    if (phoneNumber && restaurantId) {
      let customer = await Customer.findOne({ phone_number: phoneNumber });
      if (!customer) {
        customer = await Customer.create({
          name: userName || 'Anonymous Diner',
          phone_number: phoneNumber,
          email: '',
          instagram_id: '',
          facebook_id: '',
        });
      }

      await Interaction.create({
        customer: customer._id,
        restaurant_id: Number(restaurantId),
        interaction_type: 'chat_query',
      });
    }

    // 2. Simple intelligent rule-based agent (since no Gemini API key)
    const query = message.toLowerCase();
    let reply = "I'm not sure how to help with that. Try asking about our offers, location, or bookings!";
    
    // Default context restaurant (or specific if requested)
    const rId = restaurantId ? Number(restaurantId) : 1;
    const restaurant = await Restaurant.findOne({ id: rId });

    if (query.includes('hello') || query.includes('hi ') || query === 'hi') {
      reply = `Hello ${userName ? userName.split(' ')[0] : 'there'}! I'm your friendly restaurant assistant. How can I help you today?`;
    } 
    else if (query.includes('offer') || query.includes('discount') || query.includes('deal')) {
      const offers = await Offer.find({ restaurant_id: rId, status: 'active' });
      if (offers.length > 0) {
        reply = `We have some great offers! ${offers.map(o => o.title + ': ' + o.description).join(' | ')}`;
      } else if (restaurant && restaurant.offer_text) {
        reply = `Our current special: ${restaurant.offer_text}`;
      } else {
        reply = "We don't have any special offers right now, but our food is always worth it!";
      }
    } 
    else if (query.includes('where') || query.includes('location') || query.includes('address')) {
      if (restaurant) {
        reply = `${restaurant.name} is located at ${restaurant.location}. We're ${restaurant.distanceKm}km away from your current location.`;
      } else {
        reply = "I'm having trouble finding the location right now.";
      }
    }
    else if (query.includes('cuisine') || query.includes('menu') || query.includes('food')) {
      if (restaurant) {
        reply = `We serve delicious ${restaurant.cuisine} cuisine! A meal for two is approximately ₹${restaurant.priceForTwo}.`;
      } else {
        reply = "We serve a variety of delicious dishes!";
      }
    }
    else if (query.includes('book') || query.includes('reserve') || query.includes('table')) {
      reply = "You can book a table directly through the Dine Hub app by selecting your date and time in the 'Book a Table' section!";
    }
    else if (query.includes('thank')) {
      reply = "You're very welcome! Let me know if you need anything else.";
    }

    if (phoneNumber) {
      sendSmsOrWa(phoneNumber, reply).catch(err => {
        console.error('Failed to send chatbot reply to phone:', err);
      });
    }

    return res.json({ reply });
  } catch (error) {
    console.error('Chatbot Error:', error);
    return res.status(500).json({ error: 'Chatbot encountered an error', reply: "I'm having some technical difficulties. Please try again later." });
  }
});

const sendSmsOrWa = async (phoneNumber, text) => {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_SENDER_PHONE_NUMBER;

  const metaPhoneId = process.env.META_WA_PHONE_NUMBER_ID;
  const metaWaToken = process.env.META_WA_ACCESS_TOKEN;

  const isPlaceholder = (val) => !val || val.includes('your_') || val.includes('ACXXX') || val.startsWith('https://your-');
  const isTwilioConfigured = !isPlaceholder(twilioSid) && !isPlaceholder(twilioToken) && !isPlaceholder(twilioFrom);
  const isMetaWaConfigured = !isPlaceholder(metaPhoneId) && !isPlaceholder(metaWaToken);

  if (isMetaWaConfigured) {
    try {
      const waUrl = `https://graph.facebook.com/v19.0/${metaPhoneId}/messages`;
      const response = await fetch(waUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${metaWaToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phoneNumber,
          type: 'text',
          text: {
            preview_url: false,
            body: text
          }
        }),
      });
      const data = await response.json();
      if (response.ok) {
        console.log(`[Chat WhatsApp] Message sent to ${phoneNumber}`);
        return { success: true, channel: 'whatsapp' };
      } else {
        console.error(`[Chat WhatsApp Failed]`, data);
      }
    } catch (err) {
      console.error(`[Chat WhatsApp Error]`, err);
    }
  }

  if (isTwilioConfigured) {
    try {
      const twilioClient = require('twilio')(twilioSid, twilioToken);
      const msg = await twilioClient.messages.create({
        body: text,
        from: twilioFrom,
        to: phoneNumber,
      });
      console.log(`[Chat SMS] Twilio message sent to ${phoneNumber}, SID: ${msg.sid}`);
      return { success: true, channel: 'twilio_sms' };
    } catch (err) {
      console.error(`[Chat SMS Error]`, err);
    }
  }

  console.log(`[Chat Simulation] (Meta/Twilio not configured) Msg to ${phoneNumber}: "${text}"`);
  return { success: true, channel: 'simulation' };
};

module.exports = router;
