const { Client } = require('pg');

async function run() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required.');
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  await client.query(`UPDATE "ChannelIntegration" SET status = 'CONNECTED', "connectedAt" = NOW() WHERE provider = 'WHATSAPP' AND status = 'CONNECTING'`);
  const res = await client.query('SELECT status, transport FROM "ChannelIntegration" WHERE provider = $1', ['WHATSAPP']);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run();
