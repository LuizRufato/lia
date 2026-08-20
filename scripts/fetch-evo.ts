import axios from 'axios';

async function run() {
  const url = 'http://127.0.0.1:8080/instance/fetchInstances';
  const apikey = 'cc4c79dcf49a6e2f2da1e724bbf6d97a01479bd03505ad4dedcbf8269b3883b5';

  try {
    const res = await axios.get(url, { headers: { apikey } });
    console.log(JSON.stringify(res.data, null, 2));

    for (const inst of res.data) {
      const state = await axios.get(`http://127.0.0.1:8080/instance/connectionState/${inst.name}`, { headers: { apikey }});
      console.log(`STATE FOR ${inst.name}:`, JSON.stringify(state.data, null, 2));
    }
  } catch (e: any) {
    console.error(e.message);
  }
}

run();
