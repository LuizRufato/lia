import { createHmac } from "crypto";

/**
 * Generates a privacy-safe, temporal visitor hash.
 * Includes the date (YYYY-MM-DD) so the same user is unique per day, but cannot be tracked long term.
 */
export function generateVisitorHash(
  userAgent: string | undefined,
  ip: string | undefined,
  date: Date,
  secret: string,
): string {
  const normalizedUa = (userAgent || "").trim();
  const normalizedIp = (ip || "0.0.0.0").trim();
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD

  const payload = `${normalizedIp}|${normalizedUa}|${dateStr}`;

  return createHmac("sha256", secret).update(payload).digest("hex");
}
