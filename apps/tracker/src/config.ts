import type { JobsOptions } from "bullmq";

export const CLICK_QUEUE_NAME = "clicks-queue";
export const CLICK_ENQUEUE_ATTEMPTS = 3;
export const CLICK_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 },
};

// Coolify's reverse proxy reaches the container through a private Docker
// network. Public clients are never trusted as proxy hops.
export const TRUSTED_PROXY_RANGES = [
  "127.0.0.1",
  "::1",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
];

export function getClickHashSecret(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment.CLICK_HASH_SECRET?.trim();
  if (configured) return configured;

  if (environment.NODE_ENV === "production") {
    throw new Error("CLICK_HASH_SECRET is required in production");
  }

  return "dev-only-click-hash-secret";
}
