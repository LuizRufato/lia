import { Module } from '@nestjs/common';
import { AdminCommandService } from './admin-command/admin-command.service';

@Module({
  providers: [AdminCommandService],
})
export class AdminModule {}
