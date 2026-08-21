import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as bcrypt from "bcryptjs";

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const connectionString = process.env.DATABASE_URL;

  if (!email || !password || !connectionString) {
    throw new Error(
      "ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD and DATABASE_URL are required for the first production startup.",
    );
  }

  if (password.length < 12) {
    throw new Error(
      "ADMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters.",
    );
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    let tenant = await prisma.tenant.findFirst({
      where: { name: "LIA Principal" },
    });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: "LIA Principal" },
      });
    }

    let admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin) {
      admin = await prisma.adminUser.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(password, 12),
        },
      });
      console.log(`Created production administrator: ${email}`);
    } else {
      console.log(`Production administrator already exists: ${email}`);
    }

    await prisma.tenantMembership.upsert({
      where: {
        tenantId_adminUserId: {
          tenantId: tenant.id,
          adminUserId: admin.id,
        },
      },
      update: { role: "OWNER" },
      create: {
        tenantId: tenant.id,
        adminUserId: admin.id,
        role: "OWNER",
      },
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
