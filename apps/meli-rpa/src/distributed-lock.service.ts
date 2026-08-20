import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import * as crypto from "crypto";

export class LockLostError extends Error {
  constructor(message: string) {
    super(`DISTRIBUTED_LOCK_LOST: ${message}`);
    this.name = "LockLostError";
  }
}

@Injectable()
export class DistributedLockService {
  private readonly logger = new Logger(DistributedLockService.name);
  // Lua script for atomic compare-and-delete
  private readonly unlockScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  // Lua script for atomic compare-and-renew
  private readonly renewScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  constructor(private readonly redisClient: Redis) {}

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const ownerToken = crypto.randomBytes(32).toString("hex");
    const result = await this.redisClient.set(
      key,
      ownerToken,
      "PX",
      ttlMs,
      "NX",
    );
    if (result === "OK") {
      return ownerToken;
    }
    return null;
  }

  async renewLock(
    key: string,
    ownerToken: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.redisClient.eval(
      this.renewScript,
      1,
      key,
      ownerToken,
      ttlMs,
    );
    return result === 1;
  }

  async releaseLock(key: string, ownerToken: string): Promise<boolean> {
    const result = await this.redisClient.eval(
      this.unlockScript,
      1,
      key,
      ownerToken,
    );
    return result === 1;
  }
}
