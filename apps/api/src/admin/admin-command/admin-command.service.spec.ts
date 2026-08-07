import { Test, TestingModule } from '@nestjs/testing';
import { AdminCommandService } from './admin-command.service';

import { PrismaService } from '../../prisma.service';

describe('AdminCommandService', () => {
  let service: AdminCommandService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminCommandService,
        {
          provide: PrismaService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AdminCommandService>(AdminCommandService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
