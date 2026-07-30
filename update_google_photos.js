require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Paths to files we need to update
const SEED_JS_PATH = path.join(__dirname, 'seed.js');
const MOCK_DATA_PATH = path.join(__dirname, '..', 'dine-hub-magic-mobile', 'constants', 'mockData.ts');

// Determine API key
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDWEbgMG5HRYguYT7Ajx8JfycvvDxiNuFw';

async function main() {
  let isMongoConnected = false;
  let RestaurantModel;

  if (process.env.MONGO_URI) {
    console.log('Connecting to MongoDB (timeout: 5s)...');
    try {
      // Connect with a low timeout so it doesn't hang if whitelisting is blocking
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000
      });
      console.log('MongoDB Connected successfully.');
      RestaurantModel = require('./models/Restaurant');
      isMongoConnected = true;
    } catch (dbErr) {
      console.warn('\n⚠️ MongoDB Connection Failed (likely due to IP Whitelisting or network issue).');
      console.warn('Continuing in LOCAL-ONLY mode: seed.js and mockData.ts will still be updated.\n');
    }
  } else {
    console.log('\nMONGO_URI is missing in .env. Continuing in LOCAL-ONLY mode: seed.js and mockData.ts will still be updated.\n');
  }

  // Parse restaurants directly from mockData.ts
  if (!fs.existsSync(MOCK_DATA_PATH)) {
    console.error(`Mock data file not found at: ${MOCK_DATA_PATH}`);
    process.exit(1);
  }

  console.log('Parsing restaurants from mockData.ts...');
  const mockContent = fs.readFileSync(MOCK_DATA_PATH, 'utf8');
  const restaurantRegex = /id:\s*["']([^"']+)["'],\s*name:\s*["']([^"']+)["'],\s*cuisine:\s*["']([^"']+)["'],\s*location:\s*["']([^"']+)["']/g;
  
  const restaurants = [];
  let match;
  while ((match = restaurantRegex.exec(mockContent)) !== null) {
    restaurants.push({
      id: match[1],
      name: match[2],
      location: match[4]
    });
  }

  console.log(`Found ${restaurants.length} restaurants locally.`);

  const updatedRestaurants = [];

  for (let i = 0; i < restaurants.length; i++) {
    const r = restaurants[i];
    console.log(`[${i + 1}/${restaurants.length}] Fetching photos for: ${r.name} (${r.location})...`);
    
    // We add "Navi Mumbai" or "Mumbai" to make the query more specific if it isn't already there
    const queryLocation = r.location.toLowerCase().includes('mumbai') 
      ? r.location 
      : `${r.location}, Navi Mumbai`;
    
    const query = `${r.name}, ${queryLocation}`;

    try {
      const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.photos'
        },
        body: JSON.stringify({ textQuery: query })
      });

      const data = await response.json();

      if (data.error) {
        console.error(`\n========================================================================`);
        console.error(`⚠️ GOOGLE API ERROR: ${data.error.message}`);
        
        if (data.error.message.includes('Places API (New) has not been used') || data.error.message.includes('disabled')) {
          console.error(`\n👉 ACTION REQUIRED: You must enable the Places API (New) in the Google Cloud Console.`);
          console.error(`Please visit this URL to enable it:`);
          console.error(`https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=348710248423`);
        }
        console.error(`========================================================================\n`);
        
        // Stop the loop to avoid spamming blocked/disabled requests
        break;
      }

      const place = data.places && data.places[0];
      if (place && place.photos && place.photos.length > 0) {
        const photoUrls = place.photos.slice(0, 5).map(p => 
          `https://places.googleapis.com/v1/${p.name}/media?key=${GOOGLE_API_KEY}&maxWidthPx=800`
        );

        const mainImageUrl = photoUrls[0];
        
        // Update in MongoDB if connected
        if (isMongoConnected) {
          try {
            // Find in database by name or ID (match case insensitively)
            const dbRest = await RestaurantModel.findOne({ name: r.name });
            if (dbRest) {
              dbRest.image_url = mainImageUrl;
              dbRest.gallery = photoUrls;
              await dbRest.save();
              console.log(`  Updated in MongoDB.`);
            }
          } catch (dbErr) {
            console.error(`  Failed to update in MongoDB: ${dbErr.message}`);
          }
        }

        console.log(`  Successfully fetched ${photoUrls.length} photos.`);
        
        updatedRestaurants.push({
          name: r.name,
          image: mainImageUrl,
          gallery: photoUrls
        });
      } else {
        console.log('  No photos found for this restaurant.');
      }
    } catch (err) {
      console.error(`  Failed to fetch: ${err.message}`);
    }

    // Add a tiny delay to avoid hitting Google Places QPS limits
    await new Promise(res => setTimeout(res, 200));
  }

  // If we updated any restaurants, synchronize with seed.js and mockData.ts
  if (updatedRestaurants.length > 0) {
    console.log(`\nSynchronizing ${updatedRestaurants.length} updated restaurant photos to seed.js and mockData.ts...`);

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
  }

  console.log('\nTask complete!');
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
