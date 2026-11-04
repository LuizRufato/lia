import { Controller, Get } from '@nestjs/common';
import Redis from 'ioredis';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma.service';
import { Public } from '../auth/public.decorator';
import { RedisHealthIndicator } from './redis.health';
import { ConfigService } from '@nestjs/config';

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
      () =>
        this.redisHealth.pingCheck(
          'redis',
          this.configService.get<string>('REDIS_URL') ||
            'redis://localhost:6379',
        ),
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
    // Import at module level; always close the connection (previously a
    // failed ping leaked one Redis connection per call under the 30s
    // dashboard polling).
    const redisClient = new Redis(
      this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379',
    );
    try {
      const ping = await redisClient.ping();
      redisStatus = ping === 'PONG' ? 'OPERACIONAL' : 'ERRO';

      const workerHeartbeat = await redisClient.get('worker:heartbeat');
      if (workerHeartbeat) {
        workerStatus = 'OPERACIONAL';
      } else {
        workerStatus = 'INDISPONÍVEL';
      }
    } catch {
      redisStatus = 'ERRO';
    } finally {
      redisClient.quit().catch(() => undefined);
    }

    // Tracker Health
    let trackerStatus = 'ERRO';
    try {
      const trackerUrl =
        this.configService.get<string>('TRACKER_URL') ||
        'http://127.0.0.1:3002';
      const res = await fetch(`${trackerUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        trackerStatus = 'OPERACIONAL';
      }
    } catch {
      trackerStatus = 'INDISPONÍVEL';
    }

    // Integrations Status — now reported from persisted MarketplaceIntegration
    // rows instead of hardcoded strings, so the dashboard reflects reality.
    const integrations = await this.getMarketplaceHealthStatus();
    integrations.push(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: 'WhatsApp', status: 'CANAL PRINCIPAL — AGUARDANDO CONFIGURAÇÃO', type: 'channel' } as any,
    );
    integrations.push(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { name: 'Telegram', status: 'PLANEJADO PARA O FUTURO', type: 'channel' } as any,
    );

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

  private async getMarketplaceHealthStatus(): Promise<
    Array<{ name: string; status: string; type: string }>
  > {
    const label: Record<string, string> = {
      SHOPEE: 'Shopee',
      MERCADO_LIVRE: 'Mercado Livre',
    };
    try {
      const rows = await this.prisma.marketplaceIntegration.findMany({
        select: { provider: true, status: true },
      });
      const byProvider = new Map<string, string[]>();
      for (const row of rows) {
        byProvider.set(row.provider, [
          ...(byProvider.get(row.provider) ?? []),
          row.status ?? 'NOT_CONNECTED',
        ]);
      }
      const out: Array<{ name: string; status: string; type: string }> = [];
      for (const [provider, name] of Object.entries(label)) {
        const statuses = byProvider.get(provider);
        const status =
          !statuses?.length
            ? 'AGUARDANDO CONFIGURAÇÃO'
            : statuses.includes('CONNECTED')
              ? 'CONECTADO'
              : statuses.includes('NEEDS_REAUTH')
                ? 'PRECISA REAUTENTICAR'
                : 'DESCONECTADO';
        out.push({ name, status, type: 'marketplace' });
      }
      return out;
    } catch {
      return [];
    }
  }
}
