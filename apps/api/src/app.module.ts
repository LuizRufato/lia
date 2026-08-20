import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
        REDIS_URL: Joi.string().required(),
        WEB_URL: Joi.string().default('http://localhost:3001'),
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 10,
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
