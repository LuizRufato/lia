const http = require('http');

function request(method, path, data = null, cookie = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { 'Cookie': cookie } : {})
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let setCookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : null;
        resolve({
          statusCode: res.statusCode,
          body: body ? JSON.parse(body) : null,
          cookie: setCookie ? setCookie.split(';')[0] : null
        });
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTests() {
  console.log('--- TEST 1: LOGIN ---');
  const loginRes = await request('POST', '/auth/login', { email: 'admin@lia.com', password: 'admin123' });
  console.log('Login Status:', loginRes.statusCode);
  const cookie = loginRes.cookie;
  if (!cookie) throw new Error('No cookie received');

  console.log('\n--- TEST 2: /auth/tenants ---');
  const tenantRes = await request('GET', '/auth/tenants', null, cookie);
  console.log('Tenants Status:', tenantRes.statusCode);
  console.log('Tenants Body:', tenantRes.body);

  console.log('\n--- TEST 3: /health/system ---');
  const healthRes = await request('GET', '/health/system', null, cookie);
  console.log('Health Status:', healthRes.statusCode);
  console.log('Health Body:', JSON.stringify(healthRes.body, null, 2));

  console.log('\n--- TEST 4: /autopilot/dashboard ---');
  const apRes = await request('GET', '/autopilot/dashboard', null, cookie);
  console.log('Autopilot Status:', apRes.statusCode);
  console.log('Autopilot Body:', apRes.body);
}

runTests().catch(console.error);
