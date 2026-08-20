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
    try {
      // I need to inject ioredis or use the RedisService. Let's just instantiate a temporary connection for the health check.
      const Redis = require('ioredis');
      const redisClient = new Redis(
        this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379',
      );

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

    // Integrations Status
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
        status: 'CANAL PRINCIPAL — AGUARDANDO CONFIGURAÇÃO',
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
}
