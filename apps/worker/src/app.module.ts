import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaService } from './prisma.service';
import { OfferService } from './offer.service';
import { OfferProcessor } from './offer.processor';
import { ReconcilerService } from './reconciler.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
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
  providers: [PrismaService, OfferService, OfferProcessor, ReconcilerService],
})
export class AppModule {}
