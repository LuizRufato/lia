import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { Redis } from 'ioredis';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private client: Redis | null = null;

  async pingCheck(key: string, url: string): Promise<HealthIndicatorResult> {
    try {
      if (!this.client) {
        this.client = new Redis(url, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
        await this.client.connect();
      }

      await this.client.ping();

      return this.getStatus(key, true);
    } catch (error) {
      if (this.client) {
        this.client.disconnect();
        this.client = null;
      }
      throw new HealthCheckError(
        'Redis connection failed',
        this.getStatus(key, false, { message: error.message }),
      );
    }
  }
}
