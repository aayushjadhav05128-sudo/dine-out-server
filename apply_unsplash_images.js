require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Paths to files we need to update
const SEED_JS_PATH = path.join(__dirname, 'seed.js');
const MOCK_DATA_PATH = path.join(__dirname, '..', 'dine-hub-magic-mobile', 'constants', 'mockData.ts');

// Curated pool of high-quality Unsplash image IDs by category/keyword
const IMAGE_POOLS = {
  burger: [
    'photo-1568901346375-23c9450c58cd', // Classic premium burger
    'photo-1550547660-d9450f859349', // Juicy double cheese burger
    'photo-1571066811602-71683a3f680d', // Gourmet burger on plate
    'photo-1586190848861-99aa4a171e90'  // Rustic burger close up
  ],
  pizza: [
    'photo-1513104890138-7c749659a591', // Margherita woodfired
    'photo-1593560708920-61dd98c46a4e', // Slice pull cheese
    'photo-1574071318508-1cdbab80d002', // Gourmet Italian pizza
    'photo-1604382354936-07c5d9983bd3'  // Freshly baked pizza
  ],
  coffee: [
    'photo-1501339847302-ac426a4a7cbb', // Cozy cafe vibes
    'photo-1498804103079-a6351b050096', // Coffee with latte art
    'photo-1554118811-1e0d58224f24', // Rustic coffee shop interior
    'photo-1445116572660-236099ec97a0'  // Coffee cup and cookies
  ],
  dessert: [
    'photo-1563729784474-d77dbb933a9e', // Cake slice
    'photo-1551024601-bec78aea704b', // Donuts
    'photo-1565958011703-44f9829ba187', // Waffles / pastries
    'photo-1515003197210-e0cd71810b5f'  // Fine pastry
  ],
  salad: [
    'photo-1512621776951-a57141f2eefd', // Healthy salad bowl
    'photo-1540420773420-3366772f4999', // Fresh greens with avocado
    'photo-1546069901-ba9599a7e63c', // Healthy bowl with egg
    'photo-1505576399279-565b52d4ac71'  // Salmon salad
  ],
  sushi: [
    'photo-1579871494447-9811cf80d66c', // Sushi set
    'photo-1583623025817-d180a2221d0a', // Sushi roll platter
    'photo-1611143669185-af224c5e3252', // Traditional sushi
    'photo-1569718212165-3a8278d5f624'  // Asian ramen
  ],
  indian: [
    'photo-1589301760014-d929f3979dbc', // Biryani close up
    'photo-1601050690597-df056fb4ce78', // Samosas and chutney
    'photo-1626777552726-4a6b54c97e46', // Paneer tikka butter masala
    'photo-1565557623262-b51c2513a641'  // Butter chicken / curries
  ],
  thali: [
    'photo-1626132647523-66f5bf380027', // Traditional metal thali plate
    'photo-1606755962773-d324e0a13086', // Indian bread and curry bowls
    'photo-1546833999-b9f581a1996d'  // South Indian thali spread
  ],
  bar: [
    'photo-1514933651103-005eec06c04b', // Cozy lounge interior
    'photo-1470337458703-46ad1756a187', // Neon bar bottles
    'photo-1574096079513-d8259312b785', // Cocktail pouring
    'photo-1560624052-449f5ddf0c31'  // Stylish pub lounge
  ],
  rooftop: [
    'photo-1533777857889-4be7c70b33f7', // Open air restaurant
    'photo-1560624052-449f5ddf0c31', // Sky lounge rooftop
    'photo-1485182708500-e8f1f318ba72', // Sunset rooftop cocktail
    'photo-1560624052-449f5ddf0c31'  // Modern rooftop
  ],
  finedining: [
    'photo-1414235077428-338989a2e8c0', // Gourmet fine dining dish
    'photo-1544025162-d76694265947', // Luxury plate setup
    'photo-1559339352-11d035aa65de', // Upscale dining table
    'photo-1504674900247-0877df9cc836'  // Elegant layout
  ]
};

// General fallback pools by category
const CATEGORY_FALLBACKS = {
  cafe: 'coffee',
  'fine-dining': 'finedining',
  buffet: 'finedining',
  family: 'finedining',
  bar: 'bar',
  'fast-food': 'burger',
  'pure-veg': 'thali',
  nightlife: 'bar',
  rooftop: 'rooftop',
  asian: 'sushi',
  'quick-bites': 'pizza',
  'five-star': 'finedining',
  healthy: 'salad',
  thali: 'thali',
  'late-night': 'bar'
};

// Map keywords to specific image pools
function getPoolKey(name, category) {
  const lowercaseName = name.toLowerCase();
  
  if (lowercaseName.includes('burger') || lowercaseName.includes('sandwich')) return 'burger';
  if (lowercaseName.includes('pizza')) return 'pizza';
  if (lowercaseName.includes('sushi') || lowercaseName.includes('dim sum') || lowercaseName.includes('momo') || lowercaseName.includes('noodles') || lowercaseName.includes('hunan') || lowercaseName.includes('asian')) return 'sushi';
  if (lowercaseName.includes('coffee') || lowercaseName.includes('cafe') || lowercaseName.includes('starbucks') || lowercaseName.includes('chai') || lowercaseName.includes('tea')) return 'coffee';
  if (lowercaseName.includes('cake') || lowercaseName.includes('waffle') || lowercaseName.includes('sweet') || lowercaseName.includes('dessert') || lowercaseName.includes('ice cream') || lowercaseName.includes('pastry')) return 'dessert';
  if (lowercaseName.includes('salad') || lowercaseName.includes('healthy') || lowercaseName.includes('green')) return 'salad';
  if (lowercaseName.includes('beer') || lowercaseName.includes('brew') || lowercaseName.includes('bar') || lowercaseName.includes('pub') || lowercaseName.includes('lounge') || lowercaseName.includes('club') || lowercaseName.includes('cocktail')) return 'bar';
  if (lowercaseName.includes('rooftop') || lowercaseName.includes('sky')) return 'rooftop';
  if (lowercaseName.includes('thali') || lowercaseName.includes('bhojanalay') || lowercaseName.includes('veg')) return 'thali';
  if (lowercaseName.includes('biryani') || lowercaseName.includes('kebab') || lowercaseName.includes('chicken') || lowercaseName.includes('mutton') || lowercaseName.includes('dhaba') || lowercaseName.includes('kitchen')) return 'indian';

  // Fallback to category mapping
  return CATEGORY_FALLBACKS[category] || 'finedining';
}

function makeUnsplashUrl(photoId) {
  return `https://images.unsplash.com/${photoId}?q=80&w=800&auto=format&fit=crop`;
}

async function main() {
  let isMongoConnected = false;
  let RestaurantModel;

  if (process.env.MONGO_URI) {
    console.log('Connecting to MongoDB (timeout: 5s)...');
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000
      });
      console.log('MongoDB Connected successfully.');
      RestaurantModel = require('./models/Restaurant');
      isMongoConnected = true;
    } catch (dbErr) {
      console.warn('\n⚠️ MongoDB Connection Failed. Continuing in LOCAL-ONLY mode.\n');
    }
  }

  // Parse restaurants directly from mockData.ts
  if (!fs.existsSync(MOCK_DATA_PATH)) {
    console.error(`Mock data file not found at: ${MOCK_DATA_PATH}`);
    process.exit(1);
  }

  console.log('Parsing restaurants from mockData.ts...');
  const mockContent = fs.readFileSync(MOCK_DATA_PATH, 'utf8');
  const restaurantRegex = /id:\s*["']([^"']+)["'],\s*name:\s*["']([^"']+)["'],\s*cuisine:\s*["']([^"']+)["'],\s*location:\s*["']([^"']+)["'],\s*distanceKm:\s*([^\n,]+),\s*rating:\s*([^\n,]+),\s*reviews:\s*([^\n,]+),\s*priceForTwo:\s*([^\n,]+),\s*image:\s*["']([^"']+)["'],\s*category:\s*["']([^"']+)["']/g;
  
  const restaurants = [];
  let match;
  while ((match = restaurantRegex.exec(mockContent)) !== null) {
    restaurants.push({
      id: match[1],
      name: match[2],
      location: match[4],
      category: match[10]
    });
  }

  console.log(`Found ${restaurants.length} restaurants locally.`);

  const updatedRestaurants = [];

  // Seed random generator with restaurant ID sum to keep assignments stable
  for (let i = 0; i < restaurants.length; i++) {
    const r = restaurants[i];
    const poolKey = getPoolKey(r.name, r.category);
    const pool = IMAGE_POOLS[poolKey] || IMAGE_POOLS.finedining;

    // Deterministically select images based on index to ensure variety and consistency
    const mainPhotoId = pool[i % pool.length];
    const mainImageUrl = makeUnsplashUrl(mainPhotoId);

    // Get 3 extra related photos for the gallery (excluding the main photo if possible)
    const galleryPhotoIds = pool.filter(id => id !== mainPhotoId).slice(0, 3);
    // If the pool is small, add fallback images from related pools
    while (galleryPhotoIds.length < 3) {
      const extraPool = IMAGE_POOLS.finedining;
      const extraId = extraPool[galleryPhotoIds.length % extraPool.length];
      if (!galleryPhotoIds.includes(extraId)) {
        galleryPhotoIds.push(extraId);
      }
    }
    
    const galleryUrls = [mainPhotoId, ...galleryPhotoIds].map(makeUnsplashUrl);

    // Update in MongoDB if connected
    if (isMongoConnected) {
      try {
        const dbRest = await RestaurantModel.findOne({ name: r.name });
        if (dbRest) {
          dbRest.image_url = mainImageUrl;
          dbRest.gallery = galleryUrls;
          await dbRest.save();
        }
      } catch (dbErr) {
        console.error(`  Failed to update database for ${r.name}: ${dbErr.message}`);
      }
    }

    updatedRestaurants.push({
      name: r.name,
      image: mainImageUrl,
      gallery: galleryUrls
    });
  }

  console.log(`Mapping images to ${updatedRestaurants.length} restaurants...`);

  // 1. Sync seed.js
  if (fs.existsSync(SEED_JS_PATH)) {
    console.log('Updating seed.js...');
    let seedContent = fs.readFileSync(SEED_JS_PATH, 'utf8');
    for (const updated of updatedRestaurants) {
      seedContent = replaceRestaurantImages(seedContent, updated.name, true, updated.image, updated.gallery);
    }
    fs.writeFileSync(SEED_JS_PATH, seedContent, 'utf8');
    console.log('seed.js updated.');
  }

  // 2. Sync mockData.ts
  if (fs.existsSync(MOCK_DATA_PATH)) {
    console.log('Updating mockData.ts...');
    let mockContent = fs.readFileSync(MOCK_DATA_PATH, 'utf8');
    for (const updated of updatedRestaurants) {
      mockContent = replaceRestaurantImages(mockContent, updated.name, false, updated.image, updated.gallery);
    }
    fs.writeFileSync(MOCK_DATA_PATH, mockContent, 'utf8');
    console.log('mockData.ts updated.');
  }

  console.log('\nAll restaurants successfully updated with custom, category-matched Unsplash photos!');
  process.exit(0);
}

function replaceRestaurantImages(fileContent, name, isSeedJs, newImageUrl, newGallery) {
  const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const namePattern = new RegExp(`name:\\s*["']${escapedName}["']`);
  const match = fileContent.match(namePattern);
  if (!match) return fileContent;
  
  const nameIndex = match.index;
  const preSlice = fileContent.substring(0, nameIndex);
  let postSlice = fileContent.substring(nameIndex);
  
  const imageKey = isSeedJs ? 'image_url' : 'image';
  const imagePattern = new RegExp(`${imageKey}:\\s*["'][^"']*["']`);
  const imageMatch = postSlice.match(imagePattern);
  if (imageMatch) {
    const originalImageLine = imageMatch[0];
    const newImageLine = `${imageKey}: "${newImageUrl}"`;
    postSlice = postSlice.replace(imagePattern, newImageLine);
  }
  
  const galleryStartPattern = /gallery:\s*\[/;
  const galleryStartMatch = postSlice.match(galleryStartPattern);
  if (galleryStartMatch) {
    const startIdx = galleryStartMatch.index;
    let bracketCount = 1;
    let endIdx = -1;
    for (let i = startIdx + galleryStartMatch[0].length; i < postSlice.length; i++) {
      if (postSlice[i] === '[') bracketCount++;
      if (postSlice[i] === ']') {
        bracketCount--;
        if (bracketCount === 0) {
          endIdx = i;
          break;
        }
      }
    }
    
    if (endIdx !== -1) {
      const galleryItemsStr = newGallery.map(url => `      "${url}"`).join(',\n');
      const newGalleryBlock = `gallery: [\n${galleryItemsStr}\n    ]`;
      postSlice = postSlice.substring(0, startIdx) + newGalleryBlock + postSlice.substring(endIdx + 1);
    }
  }
  
  return preSlice + postSlice;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
