import { Module } from '@nestjs/common';
import { AutopilotController } from './autopilot.controller';
import { AutopilotService } from './autopilot.service';
import { PrismaModule } from '../prisma.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [PrismaModule, BullModule.registerQueue({ name: 'publisher' })],
  controllers: [AutopilotController],
  providers: [AutopilotService],
})
export class AutopilotModule {}
