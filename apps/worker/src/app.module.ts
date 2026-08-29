import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaService } from './prisma.service';
import { OfferService } from './offer.service';
import { OfferProcessor } from './offer.processor';
import { ReconcilerService } from './reconciler.service';
import { IngestionService } from './ingestion.service';

import * as Joi from 'joi';

import { TelegramModule } from './telegram/telegram.module';
import { PublisherProcessor } from './publisher/publisher.processor';
import { ClickProcessor } from './tracking/click.processor';
import { ShopeeProcessor } from './shopee/shopee.processor';
import { ShopeeSyncSchedulerService } from './shopee/shopee-sync.scheduler';
import { AutopilotSchedulerService } from './autopilot/scheduler.service';

import { WhatsAppWebhookProcessor } from './publisher/whatsapp-webhook.processor';
import { WhatsAppPublisher } from './publisher/whatsapp.publisher';
import { ShopeeConversionsProcessor } from './shopee/shopee-conversions.processor';
import { ShopeeConversionsSchedulerService } from './shopee/shopee-conversions.scheduler';
import { getBullMqRedisConnection } from '@lia/core';
import { EvolutionReconciliationService } from './whatsapp/evolution-reconciliation.service';
import { WhatsAppSafetyGovernor } from './publisher/whatsapp-safety-governor';
import { AdminAlertsProcessor } from './admin-alerts/admin-alerts.processor';
import { AdminAlertEventsService } from './admin-alerts/admin-alert-events.service';
import { AdminAlertsScheduler } from './admin-alerts/admin-alerts.scheduler';
import { GroupGrowthService } from './group-growth/group-growth.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'test' ? '../../.env.test' : '../../.env',
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string()
          .uri({ scheme: ['redis', 'rediss'] })
          .optional(),
        REDIS_HOST: Joi.string().hostname().default('localhost'),
        REDIS_PORT: Joi.number().port().default(6379),
        REDIS_PREFIX: Joi.string().default('{lia}'),
      }),
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        prefix: configService.get('REDIS_PREFIX', '{lia}'),
        connection: getBullMqRedisConnection({
          REDIS_URL: configService.get<string>('REDIS_URL'),
          REDIS_HOST: configService.get<string>('REDIS_HOST'),
          REDIS_PORT: String(configService.get<number>('REDIS_PORT', 6379)),
          REDIS_PREFIX: configService.get<string>('REDIS_PREFIX', '{lia}'),
        }),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'offer-processing',
    }),
    BullModule.registerQueue({
      name: 'publisher',
    }),
    BullModule.registerQueue({
      name: 'clicks-queue',
    }),
    BullModule.registerQueue({
      name: 'shopee-api-queue',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    }),
    BullModule.registerQueue({
      name: 'whatsapp-webhooks',
    }),
    BullModule.registerQueue({
      name: 'shopee-conversions-queue',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 35000 },
        removeOnComplete: true,
      },
    }),
    BullModule.registerQueue({
      name: 'admin-alerts',
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 20000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
    TelegramModule,
  ],
  controllers: [],
  providers: [
    PrismaService,
    OfferService,
    OfferProcessor,
    ReconcilerService,
    IngestionService,
    PublisherProcessor,
    ClickProcessor,
    ShopeeProcessor,
    ShopeeSyncSchedulerService,
    AutopilotSchedulerService,
    WhatsAppWebhookProcessor,
    WhatsAppPublisher,
    ShopeeConversionsProcessor,
    ShopeeConversionsSchedulerService,
    EvolutionReconciliationService,
    WhatsAppSafetyGovernor,
    AdminAlertsProcessor,
    AdminAlertEventsService,
    AdminAlertsScheduler,
    GroupGrowthService,
  ],
})
export class AppModule {}
