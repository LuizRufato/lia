import axios from 'axios';

async function run() {
  const baseUrl = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8080';
  const apikey = process.env.EVOLUTION_GLOBAL_API_KEY;

  if (!apikey) {
    throw new Error('EVOLUTION_GLOBAL_API_KEY is required to inspect Evolution.');
  }

  try {
    const res = await axios.get(`${baseUrl}/instance/fetchInstances`, {
      headers: { apikey },
    });
    console.log(JSON.stringify(res.data, null, 2));

    for (const inst of res.data) {
      const state = await axios.get(
        `${baseUrl}/instance/connectionState/${inst.name}`,
        { headers: { apikey } },
      );
      console.log(`STATE FOR ${inst.name}:`, JSON.stringify(state.data, null, 2));
    }
  } catch (e: any) {
    console.error(e.message);
  }
}

run();
