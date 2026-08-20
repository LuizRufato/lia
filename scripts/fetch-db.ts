import { PrismaClient } from '@prisma/client';

async function run() {
  const prisma = new PrismaClient();
  const res = await prisma.channelIntegration.findMany();
  console.log(JSON.stringify(res, null, 2));
  await prisma.$disconnect();
}
run();
