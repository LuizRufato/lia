import { getBullMqRedisConnection, getRedisConfig } from "./redis";

describe("Redis configuration", () => {
  it("uses REDIS_URL as the source of connection details", () => {
    const config = getRedisConfig({
      REDIS_URL: "rediss://queue-user:queue-pass@redis.internal:6381/2",
      REDIS_HOST: "localhost",
      REDIS_PORT: "6379",
      REDIS_PREFIX: "{lia}",
    });

    expect(config.host).toBe("redis.internal");
    expect(config.port).toBe(6381);
    expect(config.url).toBe(
      "rediss://queue-user:queue-pass@redis.internal:6381/2",
    );
    expect(
      getBullMqRedisConnection({
        REDIS_URL: "rediss://queue-user:queue-pass@redis.internal:6381/2",
        REDIS_PREFIX: "{lia}",
      }),
    ).toMatchObject({
      host: "redis.internal",
      port: 6381,
      username: "queue-user",
      password: "queue-pass",
      db: 2,
      tls: {},
    });
  });

  it("supports host and port fallback for local environments", () => {
    expect(
      getRedisConfig({
        REDIS_HOST: "redis-test",
        REDIS_PORT: "6380",
        REDIS_PREFIX: "{lia-test}",
      }),
    ).toMatchObject({
      url: "redis://localhost:6379",
      host: "redis-test",
      port: 6380,
      prefix: "{lia-test}",
    });
  });
});
