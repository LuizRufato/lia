const http = require('http');

const apiUrl = process.env.API_URL || 'http://localhost:3000';
const testEmail = process.env.ADMIN_TEST_EMAIL;
const testPassword = process.env.ADMIN_TEST_PASSWORD;

if (!testEmail || !testPassword) {
  throw new Error('ADMIN_TEST_EMAIL and ADMIN_TEST_PASSWORD are required.');
}

async function test() {
  const loginRes = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });

  if (!loginRes.ok) {
    console.log(`Login Failed: ${loginRes.status}`);
    return;
  }

  const cookie = loginRes.headers.get('set-cookie');
  
  if (!cookie) {
    console.log('No cookie returned');
    return;
  }
  // extract just the session cookie (before ';')
  const authCookie = cookie.split(';')[0];

  console.log('--- GET /auth/tenants ---');
  const tRes = await fetch(`${apiUrl}/auth/tenants`, {
    headers: { 'Cookie': authCookie }
  });
  console.log(`HTTP Status: ${tRes.status}`);
  const tText = await tRes.text();
  console.log(`Response: ${tText}`);

  console.log('\n--- GET /autopilot/dashboard ---');
  const aRes = await fetch(`${apiUrl}/autopilot/dashboard`, {
    headers: { 'Cookie': authCookie }
  });
  console.log(`HTTP Status: ${aRes.status}`);
  const aText = await aRes.text();
  console.log(`Response: ${aText}`);
}

test().catch(console.error);
