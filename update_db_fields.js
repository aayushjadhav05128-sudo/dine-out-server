require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const Restaurant = require('./models/Restaurant');

const migrate = async () => {
  try {
    await connectDB();
    
    const restaurants = await Restaurant.find({});
    console.log(`Found ${restaurants.length} restaurants to migrate.`);
    
    for (const res of restaurants) {
      // 1. Determine tier_pricing based on priceForTwo
      let tier = 500;
      if (res.priceForTwo <= 300) {
        tier = 200;
      } else if (res.priceForTwo >= 1000) {
        tier = 1000;
      }
      
      // 2. Determine dietary_type based on name and cuisine keywords
      let dietary = 'non-veg';
      const lowercaseName = res.name.toLowerCase();
      const lowercaseCuisine = res.cuisine ? res.cuisine.toLowerCase() : '';
      if (
        lowercaseName.includes('bhavan') ||
        lowercaseName.includes('bhojanalay') ||
        lowercaseName.includes('veg') ||
        lowercaseCuisine.includes('veg') ||
        lowercaseCuisine.includes('breakfast') ||
        lowercaseName.includes('tiffins')
      ) {
        dietary = 'veg';
      } else if (lowercaseCuisine.includes('egg') || lowercaseName.includes('egg')) {
        dietary = 'eggitarian';
      }
      
      // 3. Determine total_review_count
      const totalReviews = res.reviews || Math.floor(Math.random() * 150) + 20;
      
      // 4. Determine is_local_gem
      // A local gem has high rating but relatively fewer reviews, OR we mark specific legendary ones
      let localGem = false;
      if (
        lowercaseName.includes('vidyarthi') ||
        lowercaseName.includes('britannia') ||
        lowercaseName.includes('thaker') ||
        lowercaseName.includes('leopold') ||
        (res.rating >= 4.2 && totalReviews < 3000)
      ) {
        localGem = true;
      }
      
      // Update properties
      res.tier_pricing = tier;
      res.dietary_type = dietary;
      res.total_review_count = totalReviews;
      res.is_local_gem = localGem;
      
      await res.save();
      console.log(`Updated "${res.name}": Tier=${tier}, Dietary=${dietary}, Reviews=${totalReviews}, LocalGem=${localGem}`);
    }
    
    console.log('Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrate();
