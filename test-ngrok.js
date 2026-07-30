const fetch = require('node-fetch') || globalThis.fetch;

async function test() {
  console.log("Fetching from ngrok...");
  const start = Date.now();
  try {
    const res = await fetch("https://protraditional-joana-irruptively.ngrok-free.dev/api/restaurants");
    console.log("Status:", res.status);
    console.log("Status Text:", res.statusText);
    console.log("Headers:", [...res.headers.entries()]);
    const text = await res.text();
    console.log("Length of body:", text.length);
    console.log("Preview of body:", text.substring(0, 200));
  } catch (err) {
    console.error("Fetch error:", err);
  }
  console.log(`Finished in ${Date.now() - start}ms`);
}

test();
