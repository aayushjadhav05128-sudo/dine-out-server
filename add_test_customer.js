require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('./models/Customer');
const Interaction = require('./models/Interaction');

async function addTestCustomer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const phoneNumber = '+919136963301';
    const email = 'test@example.com'; // Add a fake email for Ethereal

    let customer = await Customer.findOne({ phone_number: phoneNumber });
    if (!customer) {
      customer = await Customer.create({
        name: 'Sanjay Test',
        phone_number: phoneNumber,
        email: email,
        instagram_id: 'sanjay_test_ig',
        facebook_id: 'sanjay_test_fb',
      });
      console.log('Created new test customer:', customer.name);
    } else {
      customer.name = 'Sanjay Test';
      customer.email = email;
      customer.instagram_id = 'sanjay_test_ig';
      customer.facebook_id = 'sanjay_test_fb';
      await customer.save();
      console.log('Updated existing test customer');
    }

    // Add an interaction so they appear in the CRM list for restaurant 1
    await Interaction.create({
      customer: customer._id,
      restaurant_id: 1,
      interaction_type: 'profile_view',
    });
    console.log('Added interaction for restaurant 1');

    console.log('Successfully added test customer to CRM!');
    process.exit(0);
  } catch (error) {
    console.error('Error adding test customer:', error);
    process.exit(1);
  }
}

addTestCustomer();
