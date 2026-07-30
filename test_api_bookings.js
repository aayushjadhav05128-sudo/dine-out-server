async function testApi() {
  try {
    // 1. Login to get token
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@dinehub.com',
        password: 'password123'
      })
    });
    
    if (!loginRes.ok) {
      console.error('Login failed:', loginRes.status, await loginRes.text());
      return;
    }
    
    const { token } = await loginRes.json();
    console.log('Logged in successfully! Token received.');

    // 2. Fetch bookings
    const bookingsRes = await fetch('http://localhost:3000/api/bookings', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!bookingsRes.ok) {
      console.error('Fetch bookings failed:', bookingsRes.status, await bookingsRes.text());
      return;
    }

    const bookings = await bookingsRes.json();
    console.log('Successfully fetched bookings from API!');
    console.log('Total bookings returned:', bookings.length);
    if (bookings.length > 0) {
      console.log('Latest booking:', JSON.stringify(bookings[0], null, 2));
    }
  } catch (error) {
    console.error('Test error:', error);
  }
}

testApi();
