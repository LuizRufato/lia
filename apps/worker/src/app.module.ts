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
  ],
  controllers: [],
  providers: [
    PrismaService,
    OfferService,
    OfferProcessor,
    ReconcilerService,
    IngestionService,
  ],
})
export class AppModule {}
