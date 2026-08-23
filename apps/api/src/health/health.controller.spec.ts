import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

import { HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
import { PrismaService } from '../prisma.service';
import { RedisHealthIndicator } from './redis.health';
import { ConfigService } from '@nestjs/config';
import { WhatsAppEvolutionProvider } from '@lia/integrations';

jest.mock('@lia/integrations', () => ({
  decryptSecret: jest.fn(() => 'instance-token'),
  getEncryptionKey: jest.fn(() => 'master-key'),
  WhatsAppEvolutionProvider: jest.fn(),
}));

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = {
    channelIntegration: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: { check: jest.fn() },
        },
        {
          provide: PrismaHealthIndicator,
          useValue: { pingCheck: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: RedisHealthIndicator,
          useValue: { pingCheck: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('reports configuration pending when no WhatsApp integration exists', async () => {
    prismaMock.channelIntegration.findMany.mockResolvedValueOnce([]);
    await expect((controller as any).getWhatsAppHealthStatus()).resolves.toBe(
      'CANAL PRINCIPAL — AGUARDANDO CONFIGURAÇÃO',
    );
  });

  it('checks Evolution for WEB_UNOFFICIAL instead of trusting the saved flag', async () => {
    prismaMock.channelIntegration.findMany.mockResolvedValueOnce([
      {
        transport: 'WEB_UNOFFICIAL',
        status: 'NEEDS_REAUTH',
        externalInstanceName: 'lia-tenant',
        encryptedAccessToken: 'encrypted',
        tokenIv: 'iv',
        tokenAuthTag: 'tag',
      },
    ]);
    (WhatsAppEvolutionProvider as jest.Mock).mockImplementationOnce(() => ({
      getConnectionState: jest.fn().mockResolvedValue('open'),
    }));

    await expect((controller as any).getWhatsAppHealthStatus()).resolves.toBe(
      'CONECTADO',
    );
  });
});
