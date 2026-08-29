import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { GroupGrowthService } from './group-growth.service';

@Processor('evolution-group-events')
@Injectable()
export class EvolutionGroupEventProcessor extends WorkerHost {
  constructor(private readonly groupGrowth: GroupGrowthService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'group-participant-update') return undefined;
    return this.groupGrowth.ingestParticipantUpdate(job.data);
  }
}
