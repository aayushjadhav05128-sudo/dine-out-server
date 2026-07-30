require('dotenv').config();
const ngrok = require('@ngrok/ngrok');

async function run() {
  try {
    const listener = await ngrok.forward({
      addr: 3000,
      authtoken: process.env.NGROK_AUTHTOKEN,
    });
    console.log("Success! Public URL:", listener.url());
    listener.close();
    process.exit(0);
  } catch (err) {
    console.error("Ngrok dynamic forward failed:", err);
    process.exit(1);
  }
}

run();
