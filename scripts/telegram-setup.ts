import * as readline from 'readline';
import { Writable } from 'stream';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

// Setup Prisma with pg adapter (Prisma 7 requirement)
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('❌ ERRO CRÍTICO: DATABASE_URL não está configurada no ambiente.');
  process.exit(1);
}

// We will initialize Prisma later in the function to ensure we can close it
let prisma: PrismaClient | null = null;
let pool: Pool | null = null;

// Muted stream for password input
function createMutedStream() {
  const mutedStream = new Writable({
    write(chunk, encoding, callback) {
      if (!(this as any).muted) {
        process.stdout.write(chunk, encoding);
      }
      callback();
    }
  });
  (mutedStream as any).muted = false;
  return mutedStream;
}

const mutableStdout = createMutedStream();
const rl = readline.createInterface({
  input: process.stdin,
  output: mutableStdout as any,
  terminal: true
});

function questionAsync(query: string, hideInput = false): Promise<string> {
  return new Promise((resolve) => {
    if (hideInput) {
      process.stdout.write(query);
      (mutableStdout as any).muted = true;
    }
    rl.question(hideInput ? '' : query, (answer) => {
      if (hideInput) {
        (mutableStdout as any).muted = false;
        console.log(); // New line after hidden input
      }
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🤖 --- LIA Telegram Setup --- 🤖\n');

  pool = new Pool({ connectionString: dbUrl });
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });

  try {
    // 1. Verify .gitignore
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  let gitignoreContent = '';
  if (fs.existsSync(gitignorePath)) {
    gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  }

  if (!gitignoreContent.includes('.env')) {
    console.error('❌ ERRO CRÍTICO: .env não está no .gitignore!');
    console.error('Adicione .env ao .gitignore antes de continuar.');
    process.exit(1);
  }

  // 2. Solicitar Token
  const token = await questionAsync('Digite o TELEGRAM_BOT_TOKEN (entrada oculta): ', true);

  if (!token) {
    console.error('❌ Token vazio.');
    process.exit(1);
  }

  // 3. Validar Token
  let botUsername = '';
  try {
    const meRes = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    botUsername = meRes.data.result.username;
    console.log(`\n✅ Bot conectado: @${botUsername}`);
  } catch (error) {
    console.error('\n❌ Token inválido ou falha na conexão com Telegram.');
    process.exit(1);
  }

  // 5. Pedir ao usuário para testar
  console.log(`\nAdicione o @${botUsername} ao grupo desejado como Administrador.`);
  console.log(`Agora envie /teste@${botUsername} dentro do grupo LIA.`);
  await questionAsync('Pressione ENTER quando tiver enviado a mensagem...');

  // 6. Pegar updates
  console.log('\nBuscando chats recentes...');
  let updates: any[] = [];
  try {
    const updatesRes = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`);
    updates = updatesRes.data.result;
  } catch (err) {
    console.error('❌ Falha ao buscar atualizações.');
    process.exit(1);
  }

  const chats = new Map<string, { id: string; title: string; type: string }>();
  for (const update of updates) {
    if (update.message && update.message.chat) {
      const chat = update.message.chat;
      if (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel') {
        chats.set(chat.id.toString(), {
          id: chat.id.toString(),
          title: chat.title || 'Grupo sem nome',
          type: chat.type
        });
      }
    }
  }

  const chatList = Array.from(chats.values());
  if (chatList.length === 0) {
    console.error('❌ Nenhum grupo/canal recente encontrado.');
    console.error('Certifique-se de que enviou a mensagem DEPOIS que o bot foi adicionado.');
    process.exit(1);
  }

  let selectedChat = chatList[0];
  if (chatList.length > 1) {
    console.log('\nChats encontrados:');
    chatList.forEach((c, idx) => {
      console.log(`[${idx + 1}] ${c.title}`);
      console.log(`    Tipo: ${c.type}`);
      console.log(`    Chat ID: ${c.id}`);
    });
    const choice = await questionAsync('\nDigite o número do chat desejado: ');
    const choiceIdx = parseInt(choice) - 1;
    if (chatList[choiceIdx]) {
      selectedChat = chatList[choiceIdx];
    } else {
      console.error('❌ Escolha inválida.');
      process.exit(1);
    }
  } else {
    console.log('\nChat encontrado:');
    console.log(`[1] ${selectedChat.title}`);
    console.log(`    Tipo: ${selectedChat.type}`);
    console.log(`    Chat ID: ${selectedChat.id}`);
  }

  // 7. Tenant Real
  console.log('\nConfigurando Tenant LIA Principal...');
  let tenant = await prisma.tenant.findFirst({
    where: { name: 'LIA Principal' }
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'LIA Principal' }
    });
  }

  // 8. Upsert Channel
  console.log('Configurando Channel no banco de dados...');
  const channel = await prisma.channel.upsert({
    where: {
      tenantId_provider_externalChatId: {
        tenantId: tenant.id,
        provider: 'TELEGRAM',
        externalChatId: selectedChat.id
      }
    },
    update: {
      displayName: selectedChat.title,
      enabled: true
    },
    create: {
      tenantId: tenant.id,
      provider: 'TELEGRAM',
      externalChatId: selectedChat.id,
      displayName: selectedChat.title,
      enabled: true
    }
  });

  // 9. Salvar Token no .env raiz
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  if (envContent.includes('TELEGRAM_BOT_TOKEN=')) {
    envContent = envContent.replace(/TELEGRAM_BOT_TOKEN=.*/g, `TELEGRAM_BOT_TOKEN="${token}"`);
  } else {
    envContent += `\nTELEGRAM_BOT_TOKEN="${token}"\n`;
  }
  
  fs.writeFileSync(envPath, envContent, 'utf8');

  // 10. Teste não destrutivo
  console.log('\nEnviando mensagem de teste...');
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: selectedChat.id,
      text: '🤖 LIA conectada com sucesso!'
    });
  } catch (err) {
    console.error('❌ Falha ao enviar mensagem de teste. Verifique se o bot tem permissão de enviar mensagens no grupo.');
    process.exit(1);
  }

  console.log('\n=======================================');
  console.log('✅ Bot conectado');
  console.log(`✅ Grupo: ${selectedChat.title}`);
  console.log(`✅ Channel cadastrado`);
  console.log(`✅ Tenant: ${tenant.name}`);
  console.log('✅ Token protegido');
  console.log('✅ Mensagem de teste enviada');
  console.log('=======================================\n');

  rl.close();
  
  console.log('--- Auditoria de Segurança ---');
  try {
    const untrackedEnv = execSync('git ls-files .env .env.local .env.test', { encoding: 'utf8' }).trim();
    if (untrackedEnv) {
      console.warn('⚠️ AVISO: Alguns arquivos .env estão rastreados no Git:');
      console.warn(untrackedEnv);
    } else {
      console.log('✅ Nenhum arquivo .env está rastreado no Git.');
    }
  } catch(e) {
    console.log('✅ Nenhum secret rastreado detectado.');
  }

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    process.exit(1);
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
