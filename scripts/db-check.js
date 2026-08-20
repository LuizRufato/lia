const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lia_db?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function check() {
  const admin = await prisma.adminUser.findUnique({ where: { email: 'admin@lia.com' }});
  if (!admin) {
    console.log('Admin: NOT FOUND');
    return;
  }
  console.log(`Admin ID: ${admin.id}`);

  const tenant = await prisma.tenant.findFirst({ where: { name: 'LIA Principal' }});
  if (!tenant) {
    console.log('Tenant: NOT FOUND');
    return;
  }
  console.log(`Tenant ID: ${tenant.id}`);

  const membership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_adminUserId: {
        adminUserId: admin.id,
        tenantId: tenant.id
      }
    }
  });

  if (!membership) {
    console.log('Membership: NOT FOUND');
  } else {
    console.log(`Membership: FOUND, role=${membership.role}`);
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
