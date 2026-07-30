require('dotenv').config();
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: String,
  role: String,
  restaurantId: Number
});

const User = mongoose.model('User', userSchema);

async function checkUsers() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected successfully!');
    const users = await User.find({});
    console.log(JSON.stringify(users, null, 2));
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error querying DB:', error);
  }
}

checkUsers();
