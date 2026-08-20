import { DistributedLockService } from "./distributed-lock.service";
import Redis from "ioredis-mock";

describe("DistributedLockService", () => {
  let lockService: DistributedLockService;
  let redisClient: any;

  beforeEach(async () => {
    redisClient = new Redis();
    await redisClient.flushall();
    lockService = new DistributedLockService(redisClient);
  });

  afterEach(() => {
    redisClient.disconnect();
  });

  it("A — Worker A adquire -> Worker B não adquire", async () => {
    const lockKey = "test-lock";
    const ownerA = await lockService.acquireLock(lockKey, 5000);
    expect(ownerA).not.toBeNull();

    const ownerB = await lockService.acquireLock(lockKey, 5000);
    expect(ownerB).toBeNull(); // Worker B fails to acquire
  });

  it("B — A renova corretamente -> B continua bloqueado", async () => {
    const lockKey = "test-lock";
    const ownerA = (await lockService.acquireLock(lockKey, 5000)) as string;
    expect(ownerA).not.toBeNull();

    // Renew A
    const renewed = await lockService.renewLock(lockKey, ownerA, 5000);
    expect(renewed).toBe(true);

    const ownerB = await lockService.acquireLock(lockKey, 5000);
    expect(ownerB).toBeNull();
  });

  it("C — A libera -> B consegue adquirir", async () => {
    const lockKey = "test-lock";
    const ownerA = (await lockService.acquireLock(lockKey, 5000)) as string;

    // A releases
    const released = await lockService.releaseLock(lockKey, ownerA);
    expect(released).toBe(true);

    // B can now acquire
    const ownerB = await lockService.acquireLock(lockKey, 5000);
    expect(ownerB).not.toBeNull();
    expect(ownerB).not.toBe(ownerA);
  });

  it("D — lock de A expira -> B adquire -> A tenta liberar posteriormente -> A NÃO apaga lock de B", async () => {
    const lockKey = "test-lock";
    const ownerA = (await lockService.acquireLock(lockKey, 1)) as string; // 1ms TTL

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 10));

    // B acquires
    const ownerB = (await lockService.acquireLock(lockKey, 5000)) as string;
    expect(ownerB).not.toBeNull();

    // A tries to release, should fail (return false)
    const releasedByA = await lockService.releaseLock(lockKey, ownerA);
    expect(releasedByA).toBe(false); // Did not delete

    // Ensure B still owns it
    const renewedByB = await lockService.renewLock(lockKey, ownerB, 5000);
    expect(renewedByB).toBe(true);
  });
});
