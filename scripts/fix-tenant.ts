import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/lia_db?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Fixing AdminUser and Tenant association...');

  let tenant = await prisma.tenant.findFirst({
    where: { name: 'LIA Principal' }
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: 'LIA Principal' }
    });
    console.log('Created Tenant: LIA Principal');
  }

  let admin = await prisma.adminUser.findUnique({
    where: { email: 'admin@lia.com' }
  });

  if (!admin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    admin = await prisma.adminUser.create({
      data: {
        email: 'admin@lia.com',
        passwordHash: hashedPassword
      }
    });
    console.log('Created AdminUser: admin@lia.com');
  }

  let membership = await prisma.tenantMembership.findUnique({
    where: {
      tenantId_adminUserId: {
        adminUserId: admin.id,
        tenantId: tenant.id
      }
    }
  });

  if (!membership) {
    membership = await prisma.tenantMembership.create({
      data: {
        adminUserId: admin.id,
        tenantId: tenant.id,
        role: 'OWNER'
      }
    });
    console.log('Created TenantMembership OWNER for AdminUser in LIA Principal');
  } else if (membership.role !== 'OWNER') {
    await prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { role: 'OWNER' }
    });
    console.log('Updated TenantMembership to OWNER');
  }

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
