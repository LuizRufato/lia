import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Check if "LIA Principal" tenant already exists
  let tenant = await prisma.tenant.findFirst({
    where: { name: "LIA Principal" },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: "LIA Principal",
      },
    });
    console.log(`Created Tenant: ${tenant.id}`);
  } else {
    console.log(`Found existing Tenant: ${tenant.id}`);
  }

  // Get the first AdminUser to make them OWNER
  const adminUser = await prisma.adminUser.findFirst();

  if (adminUser) {
    const existingMembership = await prisma.tenantMembership.findUnique({
      where: {
        tenantId_adminUserId: {
          tenantId: tenant.id,
          adminUserId: adminUser.id,
        },
      },
    });

    if (!existingMembership) {
      await prisma.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          adminUserId: adminUser.id,
          role: "OWNER",
        },
      });
      console.log(
        `Added AdminUser ${adminUser.id} as OWNER of Tenant ${tenant.id}`,
      );
    } else {
      console.log(
        `AdminUser ${adminUser.id} is already a member of Tenant ${tenant.id}`,
      );
    }
  } else {
    console.log(
      "No AdminUser found in the database. You will need to associate an AdminUser as OWNER manually later.",
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
