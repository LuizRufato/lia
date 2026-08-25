import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { SalesController } from './sales.controller';

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [AnalyticsController, SalesController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
