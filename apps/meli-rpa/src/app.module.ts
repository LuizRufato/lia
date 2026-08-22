import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { getBullMqRedisConnection, getRedisConfig } from "@lia/core";
import { RpaProcessor } from "./rpa.processor";
import { RpaService } from "./rpa.service";
import { PrismaService } from "./prisma.service";
import { DistributedLockService } from "./distributed-lock.service";

@Module({
  imports: [
    BullModule.forRoot({
      prefix: getRedisConfig().prefix,
      connection: getBullMqRedisConnection(),
    }),
    BullModule.registerQueue({ name: "meli-affiliate-rpa-queue" }),
  ],
  providers: [
    RpaProcessor,
    RpaService,
    PrismaService,
    {
      provide: DistributedLockService,
      useFactory: () => {
        const Redis = require("ioredis");
        const redisClient = new Redis(
          process.env.REDIS_URL || "redis://localhost:6379",
        );
        return new DistributedLockService(redisClient);
      },
    },
  ],
})
export class AppModule {}
