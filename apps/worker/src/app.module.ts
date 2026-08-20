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
import { AutopilotSchedulerService } from './autopilot/scheduler.service';

import { WhatsAppWebhookProcessor } from './publisher/whatsapp-webhook.processor';
import { WhatsAppPublisher } from './publisher/whatsapp.publisher';
import { ShopeeConversionsProcessor } from './shopee/shopee-conversions.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'test' ? '../../.env.test' : '../../.env',
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
      }),
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        prefix: configService.get('REDIS_PREFIX', '{lia}'),
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
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
        removeOnComplete: true,
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
    AutopilotSchedulerService,
    WhatsAppWebhookProcessor,
    WhatsAppPublisher,
    ShopeeConversionsProcessor,
  ],
})
export class AppModule {}
