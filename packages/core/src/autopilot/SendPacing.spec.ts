import { randomSendDelayMs, validateSendPacing } from "./SendPacing";

describe("SendPacing", () => {
  it("keeps randomized delays within the configured range", () => {
    const pacing = validateSendPacing(6, 15);
    expect(randomSendDelayMs(pacing, () => 0)).toBe(6 * 60_000);
    expect(randomSendDelayMs(pacing, () => 0.5)).toBeGreaterThanOrEqual(
      6 * 60_000,
    );
    expect(randomSendDelayMs(pacing, () => 0.999999)).toBeLessThanOrEqual(
      15 * 60_000,
    );
  });

  it("accepts equal bounds and rejects invalid ranges", () => {
    expect(validateSendPacing(6, 6)).toEqual({ minMinutes: 6, maxMinutes: 6 });
    expect(() => validateSendPacing(0, 5)).toThrow();
    expect(() => validateSendPacing(-1, 5)).toThrow();
    expect(() => validateSendPacing(10, 5)).toThrow();
    expect(() => validateSendPacing(1, 24 * 60 + 1)).toThrow();
  });
});
