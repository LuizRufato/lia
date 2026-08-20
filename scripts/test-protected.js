const http = require('http');

async function test() {
  const loginRes = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@lia.com', password: 'admin' }) // Trying default password 'admin', maybe 'password'?
  });

  if (!loginRes.ok) {
    console.log(`Login Failed: ${loginRes.status}`);
    // fallback if password is wrong
    const loginRes2 = await fetch('http://localhost:3000/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@lia.com', password: 'password' })
    });
    if (!loginRes2.ok) {
      console.log(`Login2 Failed: ${loginRes2.status}`);
      return;
    }
    var cookie = loginRes2.headers.get('set-cookie');
  } else {
    var cookie = loginRes.headers.get('set-cookie');
  }
  
  if (!cookie) {
    console.log('No cookie returned');
    return;
  }
  // extract just the session cookie (before ';')
  const authCookie = cookie.split(';')[0];

  console.log('--- GET /auth/tenants ---');
  const tRes = await fetch('http://localhost:3000/auth/tenants', {
    headers: { 'Cookie': authCookie }
  });
  console.log(`HTTP Status: ${tRes.status}`);
  const tText = await tRes.text();
  console.log(`Response: ${tText}`);

  console.log('\n--- GET /autopilot/dashboard ---');
  const aRes = await fetch('http://localhost:3000/autopilot/dashboard', {
    headers: { 'Cookie': authCookie }
  });
  console.log(`HTTP Status: ${aRes.status}`);
  const aText = await aRes.text();
  console.log(`Response: ${aText}`);
}

test().catch(console.error);
