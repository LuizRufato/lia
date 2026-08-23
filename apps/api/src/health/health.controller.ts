import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma.service';
import { Public } from '../auth/public.decorator';
import { RedisHealthIndicator } from './redis.health';
import { ConfigService } from '@nestjs/config';
import { getRedisConfig } from '@lia/core';
import { getTrackerUrl } from '../tracker-url';
import {
  decryptSecret,
  getEncryptionKey,
  WhatsAppCloudProvider,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private prisma: PrismaService,
    private redisHealth: RedisHealthIndicator,
    private configService: ConfigService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.redisHealth.pingCheck('redis', getRedisConfig().url),
    ]);
  }

  @Public()
  @Get('system')
  async getSystemStatus() {
    let apiStatus = 'OPERACIONAL';

    // DB Health
    let pgStatus = 'OPERACIONAL';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      pgStatus = 'ERRO';
    }

    // Redis & Worker Health
    let redisStatus = 'OPERACIONAL';
    let workerStatus = 'ERRO';
    try {
      // I need to inject ioredis or use the RedisService. Let's just instantiate a temporary connection for the health check.
      const Redis = require('ioredis');
      const redisClient = new Redis(getRedisConfig().url);

      const ping = await redisClient.ping();
      redisStatus = ping === 'PONG' ? 'OPERACIONAL' : 'ERRO';

      const workerHeartbeat = await redisClient.get('worker:heartbeat');
      if (workerHeartbeat) {
        workerStatus = 'OPERACIONAL';
      } else {
        workerStatus = 'INDISPONÍVEL';
      }

      redisClient.quit();
    } catch {
      redisStatus = 'ERRO';
    }

    // Tracker Health
    let trackerStatus = 'ERRO';
    try {
      const trackerUrl = getTrackerUrl({
        NODE_ENV: process.env.NODE_ENV,
        TRACKER_URL: this.configService.get<string>('TRACKER_URL'),
      });
      const res = await fetch(`${trackerUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        trackerStatus = 'OPERACIONAL';
      }
    } catch {
      trackerStatus = 'INDISPONÍVEL';
    }

    // Integrations Status
    const whatsappStatus = await this.getWhatsAppHealthStatus();
    const integrations = [
      {
        name: 'Shopee',
        status: 'AGUARDANDO CONFIGURAÇÃO',
        type: 'marketplace',
      },
      {
        name: 'Mercado Livre Developer',
        status: 'AGUARDANDO CONFIGURAÇÃO',
        type: 'marketplace',
      },
      {
        name: 'Mercado Livre Afiliados',
        status: 'INDISPONÍVEL',
        type: 'marketplace',
      },
      {
        name: 'WhatsApp',
        status: whatsappStatus,
        type: 'channel',
      },
      { name: 'Telegram', status: 'PLANEJADO PARA O FUTURO', type: 'channel' },
    ];

    return {
      core: [
        { name: 'API LIA', status: apiStatus },
        { name: 'Worker', status: workerStatus },
        { name: 'Tracker', status: trackerStatus },
        { name: 'PostgreSQL', status: pgStatus },
        { name: 'Redis', status: redisStatus },
      ],
      integrations,
    };
  }

  /**
   * /health/system has no tenant context, so it aggregates every WhatsApp
   * integration and prefers the most operational state. Evolution rows are
   * checked against the provider; the persisted status is not authoritative.
   */
  private async getWhatsAppHealthStatus(): Promise<string> {
    let integrations: Array<{
      transport: string;
      status: string;
      externalInstanceName: string | null;
      wabaId: string | null;
      phoneNumberId: string | null;
      encryptedAccessToken: string | null;
      tokenIv: string | null;
      tokenAuthTag: string | null;
    }>;
    try {
      integrations = await this.prisma.channelIntegration.findMany({
        where: { provider: 'WHATSAPP' },
        select: {
          transport: true,
          status: true,
          externalInstanceName: true,
          wabaId: true,
          phoneNumberId: true,
          encryptedAccessToken: true,
          tokenIv: true,
          tokenAuthTag: true,
        },
      });
    } catch {
      return 'ERRO';
    }

    if (!integrations.length) {
      return 'CANAL PRINCIPAL — AGUARDANDO CONFIGURAÇÃO';
    }

    const states = await Promise.all(
      integrations.map(async (integration) => {
        if (integration.transport !== 'WEB_UNOFFICIAL') {
          if (
            integration.transport !== 'CLOUD_OFFICIAL' ||
            !integration.wabaId ||
            !integration.phoneNumberId ||
            !integration.encryptedAccessToken ||
            !integration.tokenIv ||
            !integration.tokenAuthTag
          ) {
            return 'NOT_CONNECTED';
          }
          try {
            if (!process.env.INTEGRATION_SECRET_KEY) {
              process.env.INTEGRATION_SECRET_KEY = getEncryptionKey();
            }
            const connected = await new WhatsAppCloudProvider().testConnection({
              wabaId: integration.wabaId,
              phoneNumberId: integration.phoneNumberId,
              encryptedAccessToken: integration.encryptedAccessToken,
              tokenIv: integration.tokenIv,
              tokenAuthTag: integration.tokenAuthTag,
            });
            return connected ? 'CONNECTED' : 'ERROR';
          } catch {
            return 'ERROR';
          }
        }
        if (
          !integration.externalInstanceName ||
          !integration.encryptedAccessToken ||
          !integration.tokenIv ||
          !integration.tokenAuthTag
        ) {
          return 'NOT_CONNECTED';
        }

        try {
          const token = decryptSecret(
            integration.encryptedAccessToken,
            integration.tokenIv,
            integration.tokenAuthTag,
            getEncryptionKey(),
          );
          const provider = new WhatsAppEvolutionProvider();
          const state = await new Promise<
            Awaited<ReturnType<WhatsAppEvolutionProvider['getConnectionState']>>
          >((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
              settled = true;
              resolve('UNKNOWN');
            }, 1500);
            provider
              .getConnectionState(integration.externalInstanceName!, token)
              .then((value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
              })
              .catch(() => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve('UNKNOWN');
              });
          });
          if (state === 'open') return 'CONNECTED';
          if (state === 'connecting') return 'CONNECTING';
          if (
            state === 'close' ||
            state === 'DISCONNECTED' ||
            state === 'UNAUTHORIZED'
          ) {
            return 'NEEDS_REAUTH';
          }
          return 'ERROR';
        } catch {
          return 'ERROR';
        }
      }),
    );

    if (states.includes('CONNECTED')) return 'CONECTADO';
    if (states.includes('CONNECTING')) return 'CONECTANDO';
    if (states.includes('NEEDS_REAUTH')) return 'NECESSITA REAUTENTICAÇÃO';
    if (states.includes('ERROR')) return 'ERRO';
    return 'CANAL PRINCIPAL — AGUARDANDO CONFIGURAÇÃO';
  }
}
