const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: "postgresql://user:b4b1ebc2689801b6e701ec142841cd59fcbb0bd067c8eda4@localhost:5432/lia_db?schema=public"
  });
  await client.connect();
  await client.query(`UPDATE "ChannelIntegration" SET status = 'CONNECTED', "connectedAt" = NOW() WHERE provider = 'WHATSAPP' AND status = 'CONNECTING'`);
  const res = await client.query('SELECT status, transport FROM "ChannelIntegration" WHERE provider = $1', ['WHATSAPP']);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
}
run();
