import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient();
  const integrations = await prisma.channelIntegration.findMany({
    where: { provider: 'WHATSAPP', transport: 'WEB_UNOFFICIAL' }
  });
  
  for (const i of integrations) {
    console.log(`Integration DB: ID=${i.id} tenant=${i.tenantId} instanceName=${i.externalInstanceName} status=${i.status}`);
  }
  
  await prisma.$disconnect();
}

run().catch(console.error);
