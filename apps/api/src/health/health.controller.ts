import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, PrismaHealthIndicator } from '@nestjs/terminus';
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
      () => this.redisHealth.pingCheck('redis', this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379'),
    ]);
  }
}
