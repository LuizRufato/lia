import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { AdminAlertsController } from './admin-alerts.controller';
import { AdminAlertsService } from './admin-alerts.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAlertsController],
  providers: [AdminAlertsService],
})
export class AdminAlertsModule {}
