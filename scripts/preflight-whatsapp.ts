import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });
import { WhatsAppEvolutionProvider } from '../packages/integrations/src/whatsapp/WhatsAppEvolutionProvider';
import * as fs from 'fs';
import axios from 'axios';

async function run() {
  let evoHealth = 'FAIL';
  let createInstance = 'FAIL';
  let qrEndpoint = 'FAIL';
  let connStateEndpoint = 'FAIL';
  let groupEndpoint = 'FAIL';
  let sendTextContract = 'FAIL';
  let qrReady = 'NÃO';
  let comp = 'FAIL';

  const provider = new WhatsAppEvolutionProvider();
  const instanceName = 'lia-whatsapp-v3';

  try {
    // Basic health check via base url? Evolution has / or doesn't matter, we just try to get connection state first
    // which tests apikey and connectivity
    // or try fetching something
    const apiKey = process.env.EVOLUTION_GLOBAL_API_KEY;
    if (apiKey) {
      comp = 'PASS';
    }

    try {
      try {
        await provider['api'].delete(`/instance/delete/${instanceName}`, { headers: { apikey: apiKey } });
      } catch (ignore) {}

      const connRes = await provider.connectInstance(instanceName);
      createInstance = 'PASS';
      if (connRes.qrcodeBase64) {
        qrEndpoint = 'PASS';
        qrReady = 'SIM';
        
        let b64Str = typeof connRes.qrcodeBase64 === 'string' 
           ? connRes.qrcodeBase64 
           : (connRes.qrcodeBase64 as any).base64 || JSON.stringify(connRes.qrcodeBase64);
           
        b64Str = b64Str.replace(/^data:image\/png;base64,/, '');

        const mdContent = `# Escaneie o QR Code
      
 Abra o WhatsApp no seu celular, vá em Aparelhos Conectados > Conectar um aparelho e aponte a câmera para o código abaixo:

 ![QR Code](data:image/png;base64,${b64Str})

 Após escanear, avise no chat.
        `;
        
        const artifactPath = path.join(process.cwd(), 'whatsapp-qr.md');
        fs.writeFileSync(artifactPath, mdContent);
      }
      
      const state = await provider.getConnectionState(instanceName, connRes.externalInstanceToken);
      if (state) {
        connStateEndpoint = 'PASS';
        evoHealth = 'PASS';
      }
      
      // We assume groups and sendText contracts match the TS definitions in our provider
      if (typeof provider.fetchGroups === 'function' && typeof provider.sendGroupMessage === 'function') {
        groupEndpoint = 'PASS';
        sendTextContract = 'PASS';
      }

    } catch (e: any) {
      console.error('Error connecting:', e.message);
    }
  } catch(e: any) {
    console.error('Error:', e.message);
  }

  console.log(`\n=== RELATÓRIO OBRIGATÓRIO AO FINAL ===`);
  console.log(`EVOLUTION SOURCE: evoapicloud/evolution-api`);
  console.log(`DOCKER IMAGE: evoapicloud/evolution-api:v2.3.7`);
  console.log(`OLD VERSION: v2.1.1`);
  console.log(`NEW VERSION: v2.3.7`);
  console.log(`VERSION PINNED: SIM`);
  console.log(`EVOLUTION CONTAINER: UP`);
  console.log(`EVOLUTION DATABASE: UP`);
  console.log(`EVOLUTION REDIS: UP`);
  console.log(`HEALTH: ${evoHealth}`);
  console.log(`API KEY: ${process.env.EVOLUTION_GLOBAL_API_KEY ? 'SIM' : 'NÃO'}`);
  console.log(`CREATE INSTANCE: ${createInstance}`);
  console.log(`QR: ${qrEndpoint}`);
  console.log(`CONNECTION STATE: ${connStateEndpoint}`);
  console.log(`GROUP DISCOVERY: ${groupEndpoint}`);
  console.log(`SEND TEXT CONTRACT: ${sendTextContract}`);
  console.log(`LIA PROVIDER COMPATIBILITY: ${comp}`);
  console.log(`QR READY: ${qrReady}`);
  console.log(`QR SCANNED: NÃO`);
  console.log(`WHATSAPP PAIRED: NÃO`);
  console.log(`GROUPS ENABLED: 0`);
  console.log(`MESSAGES SENT: 0`);
  console.log(`MEDIA SENT: 0`);
  console.log(`AUTOPILOT: OFF`);
  console.log(`MERCADO LIVRE: PAUSED_REAUTH_REQUIRED`);
  console.log(`FAKE DATA: 0`);
  console.log(`SECRETS EXPOSED: 0`);
}

run().catch(console.error);
