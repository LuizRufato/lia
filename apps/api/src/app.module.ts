import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import * as Joi from 'joi';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AnalyticsModule } from './analytics/analytics.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AutopilotModule } from './autopilot/autopilot.module';
import { OffersModule } from './offers/offers.module';
import { ChannelsModule } from './channels/channels.module';
import { getBullMqRedisConnection } from '@lia/core';
import { getRateLimitPolicy } from './rate-limit.policy';
import { AdminAlertsModule } from './admin-alerts/admin-alerts.module';
import { TemplatesModule } from './templates/templates.module';
import { PublicationsModule } from './publications/publications.module';
import { PublicSearchModule } from './public-search/public-search.module';
import { AdsModule } from './ads/ads.module';
import { MetaAcquisitionModule } from './meta-acquisition/meta-acquisition.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'test' ? '../../.env.test' : '../../.env',
      validationSchema: Joi.object({
        PORT: Joi.number().default(3000),
        JWT_SECRET: Joi.string().min(32).required(),
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string()
          .uri({ scheme: ['redis', 'rediss'] })
          .optional(),
        REDIS_HOST: Joi.string().hostname().default('localhost'),
        REDIS_PORT: Joi.number().port().default(6379),
        REDIS_PREFIX: Joi.string().default('{lia}'),
        WEB_URL: Joi.string().default('http://localhost:3001'),
        AUTH_COOKIE_DOMAIN: Joi.string().trim().hostname().allow('').optional(),
        TRACKER_URL: Joi.string()
          .uri({ scheme: ['http', 'https'] })
          .optional(),
        TRACKER_PUBLIC_BASE_URL: Joi.string()
          .uri({ scheme: ['http', 'https'] })
          .optional(),
      }),
    }),
    // The API only enqueues jobs, but it must use the exact same Redis
    // connection and prefix as the Worker. Without this shared root
    // configuration, BullMQ uses its default prefix and the Worker never sees
    // jobs created by the integration endpoints.
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
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: (context) => getRateLimitPolicy(context).ttl,
        limit: (context) => getRateLimitPolicy(context).limit,
        blockDuration: (context) => getRateLimitPolicy(context).blockDuration,
      },
    ]),
    AdminModule,
    AuthModule,
    HealthModule,
    AnalyticsModule,
    IntegrationsModule,
    AutopilotModule,
    OffersModule,
    ChannelsModule,
    AdminAlertsModule,
    TemplatesModule,
    PublicationsModule,
    PublicSearchModule,
    AdsModule,
    MetaAcquisitionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
