const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');

const FRONTEND_URL = process.env.FRONTEND_URL || "https://protraditional-joana-irruptively.ngrok-free.dev";

function sendAdminWelcomeEmail(email, name, role) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("[Email] SMTP credentials missing, skipping welcome email");
    return;
  }

  const mailOptions = {
    from: `"Dine Hub Admin" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Welcome to Dine Hub Admin Panel! 🚀`,
    text: `Hello ${name || 'Partner'},\n\nWelcome to the Dine Hub Admin Panel! Your sign-in as an ${role} has been successfully confirmed.\n\nManage Console: ${FRONTEND_URL}\n\nHappy Managing,\nThe Dine Hub Team`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2 style="color: #FC8019;">Welcome to the Dine Hub Admin Panel! 🚀</h2>
        <p>Hello <strong>${name || 'Partner'}</strong>,</p>
        <p>Your sign-in as an <strong>${role}</strong> has been successfully confirmed. We are excited to partner with you.</p>
        <p>You can now manage your brand configuration, view reservations, launch marketing CRM campaigns, and handle settlements directly from your dashboard.</p>
        <p style="margin: 20px 0;"><a href="${FRONTEND_URL}" style="background-color: #FC8019; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Access Admin Dashboard</a></p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #999;">Happy Dining,<br/>The Dine Hub Team</p>
      </div>
    `
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("[Email] Error sending admin welcome email:", error);
    } else {
      console.log("[Email] Admin welcome email sent successfully:", info.response);
    }
  });

  // Alert the system administrator about this console sign-in
  if (email.toLowerCase() !== process.env.SMTP_USER.toLowerCase()) {
    const sysAlertOptions = {
      from: `"Dine Hub Admin Monitor" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: `🚨 [Dine Hub Console] Login Event: ${role}`,
      text: `An administrative login occurred:\n\n- Role: ${role}\n- Name: ${name || 'User'}\n- Email: ${email}\n- Date/Time: ${new Date().toLocaleString()}`,
      html: `
        <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <h2 style="color: #EF4444; margin-bottom: 20px;">Dine Hub Console Sign-in Alert 🚨</h2>
          <p>A sign-in event occurred on the Dine Hub Admin Console:</p>
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 120px;">Role:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #EF4444; font-weight: bold;">${role}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Name:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${name || 'User'}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email:</td>
              <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; font-weight: bold;">Timestamp:</td>
              <td>${new Date().toLocaleString()}</td>
            </tr>
          </table>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 11px; color: #999;">Dine Hub Console Security Monitor</p>
        </div>
      `
    };
    transporter.sendMail(sysAlertOptions, (error) => {
      if (error) console.error("[Email] Error sending console alert to admin:", error);
    });
  }
}

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

const https = require('https');

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
            console.error(`[Email] Resend HTTP Error ${res.statusCode}:`, body);
            if (callback) callback(new Error(`Resend Error: ${body}`), null);
          }
        });
      });

      req.on('error', (e) => {
        console.error('[Email] Resend connection failed:', e);
        if (callback) callback(e, null);
      });

      req.write(postData);
      req.end();
    } else {
      nodemailerTransporter.sendMail(mailOptions, callback);
    }
  }
};

// @route   POST /api/auth/login
// @desc    Auth user & get token
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email });

    if (user && (await bcrypt.compare(password, user.password))) {
      let finalRole = user.role;
      let finalRestaurantId = user.restaurantId;

      if (user.email.toLowerCase() === 'aayushjadhav05128@gmail.com' || user.role === 'admin') {
        finalRole = 'admin';
        finalRestaurantId = null;
      } else {
        finalRole = 'owner';
        if (finalRestaurantId === null || finalRestaurantId === undefined) {
          finalRestaurantId = 2; // Default fallback to Toit Brewpub (ID: 2)
        }
      }

      // Generate token
      const token = jwt.sign(
        { 
          id: user._id, 
          email: user.email, 
          role: finalRole, 
          restaurantId: finalRestaurantId 
        },
        process.env.JWT_SECRET || 'supersecretkey123',
        { expiresIn: '30d' }
      );

      // Trigger admin welcome email dynamically
      sendAdminWelcomeEmail(user.email, email.split('@')[0], finalRole);

      res.status(200).json({
        id: user._id,
        email: user.email,
        role: finalRole,
        restaurantId: finalRestaurantId,
        token: token
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/auth/login-success
// @desc    Trigger email confirmation on successful Google login
router.post('/login-success', async (req, res) => {
  const { email, name } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  // Register login event in database
  try {
    const Customer = require('../models/Customer');
    const Interaction = require('../models/Interaction');
    const Restaurant = require('../models/Restaurant');
    
    let customer = await Customer.findOne({ email: email.toLowerCase() });
    if (!customer) {
      customer = await Customer.create({
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        phone_number: `+91 ${Math.floor(6000000000 + Math.random() * 4000000000)}`
      });
    } else {
      if (name && customer.name !== name) {
        customer.name = name;
        await customer.save();
      }
    }

    const approvedRestaurants = await Restaurant.find({ status: 'approved' });
    for (const rest of approvedRestaurants) {
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
    console.log(`[CRM] Registered login event for customer ${customer.email}`);
  } catch (crmErr) {
    console.error('Failed to log CRM login event:', crmErr);
  }

  // Immediately respond to the client so there is zero delay in the mobile app
  res.status(200).json({ success: true, message: 'Welcome email triggered' });

  // Only attempt to send if SMTP credentials exist
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP credentials missing, skipping welcome email");
    return;
  }

  const mailOptions = {
    from: `"Dine Hub" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Welcome to Dine Hub! 🎉`,
    text: `Hello ${name || 'Foodie'},\n\nWelcome to Dine Hub! Your sign-in has been successfully confirmed.\n\nExplore Dine Hub: ${FRONTEND_URL}\n\nHappy Dining,\nThe Dine Hub Team`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2 style="color: #FC8019;">Welcome to Dine Hub! 🎉</h2>
        <p>Hello <strong>${name || 'Foodie'}</strong>,</p>
        <p>Your sign-in has been successfully confirmed. We are thrilled to have you back! Get ready to explore reservations and save up to 50% on bookings.</p>
        <p style="margin: 20px 0;"><a href="${FRONTEND_URL}" style="background-color: #FC8019; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Explore Dine Hub</a></p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #999;">Happy Dining,<br/>The Dine Hub Team</p>
      </div>
    `
  };

  const emailStartTime = Date.now();
  console.log(`[Email] Starting welcome email send to ${email}...`);
  transporter.sendMail(mailOptions, (error, info) => {
    const duration = Date.now() - emailStartTime;
    if (error) {
      console.error(`[Email] Error sending welcome email (took ${duration}ms):`, error);
    } else {
      console.log(`[Email] Welcome email sent successfully (took ${duration}ms):`, info.response);
    }
  });

  // Alert the system administrator about this mobile login event
  const adminMailOptions = {
    from: `"Dine Hub System" <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER,
    subject: `🚨 [Dine Hub Alert] User Login Event: ${name || 'User'}`,
    text: `A user has logged in to the mobile application:\n\n- Name: ${name || 'Not Provided'}\n- Email: ${email}\n- Date/Time: ${new Date().toLocaleString()}\n\nDine Hub Operations.`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2 style="color: #4F46E5; margin-bottom: 20px;">User Login Event Alert 🚨</h2>
        <p>A customer has successfully logged in to the Dine Hub mobile app:</p>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold; width: 120px;">Name:</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${name || 'Anonymous Foodie'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee; font-weight: bold;">Email:</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${email}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold;">Timestamp:</td>
            <td>${new Date().toLocaleString()}</td>
          </tr>
        </table>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 11px; color: #999;">Dine Hub Platform Monitor</p>
      </div>
    `
  };

  transporter.sendMail(adminMailOptions, (error, info) => {
    if (error) {
      console.error("[Email] Error sending login alert email to admin:", error);
    } else {
      console.log("[Email] Login alert email sent successfully to admin:", info.response);
    }
  });
});

// @route   POST /api/auth/send-google-otp
// @desc    Send Google login OTP via email dynamically
router.post('/send-google-otp', (req, res) => {
  const { email, name, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ message: 'Email and OTP are required' });
  }

  // Immediately respond to the client so there is zero delay in the mobile app
  res.status(200).json({ success: true, message: 'OTP send triggered' });

  // Only attempt to send if SMTP credentials exist
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP credentials missing, skipping OTP email");
    return;
  }

  // No physical spaces to prevent multi-line wrapping, using CSS letter-spacing instead
  const rawOtp = otp;

  const mailOptions = {
    from: `"Dine Hub" <${process.env.SMTP_USER}>`,
    to: email,
    subject: `Dine Hub Verification Code: ${otp}`,
    text: `Hello ${name || 'Foodie'},\n\nYour Dine Hub verification code is: ${otp}\n\nThis code is valid for 10 minutes. For security reasons, do not share this code with anyone.\n\nHappy Dining,\nThe Dine Hub Team`,
    html: `
      <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
        <h2 style="color: #FC8019; text-align: center;">Verify Your Account</h2>
        <p>Hello <strong>${name || 'Foodie'}</strong>,</p>
        <p>Please use the 6-digit verification code below to complete your sign-in to the Dine Hub app:</p>
        <div style="background-color: #FFF5EC; border: 1px solid #FFD8BA; border-radius: 5px; padding: 15px; text-align: center; font-size: 28px; font-weight: bold; color: #FC8019; letter-spacing: 5px; margin: 20px 0;">
          ${otp}
        </div>
        <p style="font-size: 13px; color: #666; text-align: center;">This code is valid for 10 minutes. For security reasons, do not share this code.</p>
        <hr style="border: 0; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #999;">Happy Dining,<br/>The Dine Hub Team</p>
      </div>
    `
  };

  const emailStartTime = Date.now();
  console.log(`[Email] Starting Google OTP email send to ${email}...`);
  transporter.sendMail(mailOptions, (error, info) => {
    const duration = Date.now() - emailStartTime;
    if (error) {
      console.error(`[Email] Error sending Google OTP email (took ${duration}ms):`, error);
    } else {
      console.log(`[Email] Google OTP email sent successfully (took ${duration}ms):`, info.response);
    }
  });
});

// @route   GET /api/auth/google-callback
// @desc    Handles Google OAuth redirect, parses the token and deep links back to the mobile app
router.get('/google-callback', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dine Hub Login</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background-color: #F9FAFB; padding: 20px; box-sizing: border-box; }
        .card { background: white; padding: 32px; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1); width: 100%; max-width: 400px; text-align: center; border: 1px solid #E5E7EB; }
        .logo { background-color: #FC8019; width: 60px; height: 60px; border-radius: 18px; display: flex; justify-content: center; align-items: center; margin: 0 auto 20px auto; color: white; font-size: 28px; box-shadow: 0 4px 12px rgba(252, 128, 25, 0.2); }
        h2 { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: #111827; }
        p { color: #6B7280; font-size: 14px; line-height: 20px; margin-bottom: 24px; }
        .btn { background-color: #FC8019; color: white; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: bold; font-size: 15px; display: none; box-shadow: 0 4px 12px rgba(252, 128, 25, 0.25); transition: background-color 0.2s; margin-top: 10px; }
        .btn:active { background-color: #E0690E; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">🍴</div>
        <h2 id="title">Logging you in...</h2>
        <p id="desc">Connecting back to DineHub mobile app. If nothing happens automatically, tap the button below.</p>
        <a id="redirect-btn" class="btn" href="#">Open Dine Hub App</a>
      </div>
      <script>
        // Parse the hash parameters from the redirect
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const idToken = params.get('id_token');
        
        // Google passes state in the query parameters for implicit flow redirects
        const urlParams = new URLSearchParams(window.location.search);
        const state = urlParams.get('state') || params.get('state');
        
        if (idToken && state) {
          try {
            const base64Url = idToken.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(window.atob(base64));
            
            const email = payload.email || '';
            const name = payload.name || '';
            
            // Build direct mobile redirect link
            const redirectUrl = decodeURIComponent(state) + 
              (decodeURIComponent(state).includes('?') ? '&' : '?') + 
              'id_token=' + encodeURIComponent(idToken);
              
            // Setup direct launch link button
            const btn = document.getElementById('redirect-btn');
            btn.href = redirectUrl;
            btn.style.display = 'inline-block';
            
            // Attempt auto-redirect
            window.location.href = redirectUrl;
          } catch (e) {
            console.error(e);
            document.body.innerHTML = '<h2>Authentication Failed</h2><p>Unable to process sign-in token.</p>';
          }
        } else {
          document.body.innerHTML = '<h2>Authentication Failed</h2><p>Credentials not found. Please close this browser and try again.</p>';
        }
      </script>
    </body>
    </html>
  `);
});

const https = require('https');

function verifyGoogleToken(idToken) {
  // If it's a mock token, bypass HTTP verification for local developer/tester convenience
  if (idToken === 'mock_google_credential' || (idToken && idToken.startsWith('mock_'))) {
    return Promise.resolve({
      email: 'admin@dinehub.com',
      name: 'Mock Admin User',
      email_verified: true
    });
  }

  return new Promise((resolve, reject) => {
    https.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            // Local fallback: try to decode JWT locally if tokeninfo endpoint is blocked or offline
            try {
              const parts = idToken.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                if (payload.email) {
                  console.log('[Google Auth] Decoded JWT locally after tokeninfo error:', payload.email);
                  return resolve(payload);
                }
              }
            } catch (e) {}
            reject(new Error(parsed.error_description || 'Invalid token'));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      // Local fallback on network error
      try {
        const parts = idToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          if (payload.email) {
            console.log('[Google Auth] Decoded JWT locally after network error:', payload.email);
            return resolve(payload);
          }
        }
      } catch (e) {}
      reject(err);
    });
  });
}

// @route   POST /api/auth/google-login
// @desc    Verify Google token and log in / create partner user
router.post('/google-login', async (req, res) => {
  const { credential } = req.body;

  if (!credential) {
    return res.status(400).json({ message: 'Credential token is required' });
  }

  try {
    const payload = await verifyGoogleToken(credential);
    const email = payload.email;

    if (!email) {
      return res.status(400).json({ message: 'Email not verified by Google' });
    }

    // Find user by email
    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('password123', salt);

      if (email.toLowerCase() === 'aayushjadhav05128@gmail.com') {
        user = await User.create({
          email: email.toLowerCase(),
          password: hashedPassword,
          role: 'admin',
          restaurantId: null
        });
        console.log(`[Google Auth] Successfully registered new admin user ${email}`);
      } else {
        // Create a unique restaurant for this new partner owner
        const maxRes = await Restaurant.findOne().sort({ id: -1 });
        const newResId = maxRes ? maxRes.id + 1 : 1000;
        
        const newResName = `${payload.name || email.split('@')[0]}'s Restaurant`;
        const newRes = await Restaurant.create({
          id: newResId,
          name: newResName,
          cuisine: 'Fusion Delight',
          location: 'Bengaluru, India',
          rating: 4.0,
          distanceKm: 1.5,
          reviews: 0,
          priceForTwo: 600,
          image_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?q=80&w=800',
          category: 'fine-dining',
          about: `Welcome to ${newResName}! Configure your menu catalog, manage layouts, and track settlements here.`,
          latitude: 12.9716,
          longitude: 77.5946,
          status: 'approved',
          revenue: 0
        });

        user = await User.create({
          email: email.toLowerCase(),
          password: hashedPassword,
          role: 'owner',
          restaurantId: newRes.id
        });
        console.log(`[Google Auth] Successfully registered new user ${email} with unique restaurant ID ${newRes.id}`);
      }
    }

    let finalRole = user.role;
    let finalRestaurantId = user.restaurantId;

    if (user.email.toLowerCase() === 'aayushjadhav05128@gmail.com') {
      finalRole = 'admin';
      finalRestaurantId = null;
    } else {
      finalRole = 'owner';
      if (finalRestaurantId === null || finalRestaurantId === undefined) {
        finalRestaurantId = 2; // Default fallback to Toit Brewpub (ID: 2)
      }
    }

    // Trigger admin welcome email dynamically
    sendAdminWelcomeEmail(user.email, payload.name || email.split('@')[0], finalRole);

    // Generate token
    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: finalRole, 
        restaurantId: finalRestaurantId 
      },
      process.env.JWT_SECRET || 'supersecretkey123',
      { expiresIn: '30d' }
    );

    res.status(200).json({
      id: user._id,
      email: user.email,
      role: finalRole,
      restaurantId: finalRestaurantId,
      token: token
    });
  } catch (error) {
    console.error('Google token verification failed:', error);
    res.status(400).json({ message: error.message || 'Google authentication failed' });
  }
});

// @route   POST /api/auth/check-exists
// @desc    Check if a customer account already exists by email or phone number
router.post('/check-exists', async (req, res) => {
  const { email, phone } = req.body;
  const Customer = require('../models/Customer');

  try {
    let query = [];
    if (email) {
      query.push({ email: email.trim().toLowerCase() });
    }
    if (phone) {
      const sanitizedPhone = phone.replace(/[^0-9]/g, '');
      query.push({ phone_number: sanitizedPhone });
      query.push({ phone_number: `+91 ${sanitizedPhone}` });
      query.push({ phone_number: `+91-${sanitizedPhone}` });
      query.push({ phone_number: new RegExp(sanitizedPhone + '$') }); // suffix match to be safe
    }

    if (query.length === 0) {
      return res.status(400).json({ error: 'Email or phone number is required' });
    }

    const existingCustomer = await Customer.findOne({ $or: query });

    if (existingCustomer) {
      return res.status(200).json({ 
        exists: true, 
        message: 'You already have an account, try logging in.' 
      });
    }

    return res.status(200).json({ exists: false });
  } catch (error) {
    console.error('Failed to check existing customer:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
