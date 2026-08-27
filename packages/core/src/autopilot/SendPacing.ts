export interface SendPacing {
  minMinutes: number;
  maxMinutes: number;
}

export const MAX_SEND_INTERVAL_MINUTES = 24 * 60;

export function validateSendPacing(
  minMinutes: unknown,
  maxMinutes: unknown,
): SendPacing {
  if (
    !Number.isInteger(minMinutes) ||
    !Number.isInteger(maxMinutes) ||
    (minMinutes as number) < 1 ||
    (maxMinutes as number) < (minMinutes as number) ||
    (maxMinutes as number) > MAX_SEND_INTERVAL_MINUTES
  ) {
    throw new Error("Intervalo de envio inválido.");
  }

  return { minMinutes: minMinutes as number, maxMinutes: maxMinutes as number };
}

export function randomSendDelayMs(
  pacing: SendPacing,
  random: () => number = Math.random,
): number {
  const minMs = pacing.minMinutes * 60_000;
  const maxMs = pacing.maxMinutes * 60_000;
  const sample = Math.min(0.999999999, Math.max(0, random()));
  return minMs + Math.floor(sample * (maxMs - minMs + 1));
}
