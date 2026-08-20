export function getEncryptionKey(): string {
  let rawKey = process.env.INTEGRATION_ENCRYPTION_KEY || "";

  // Remove possible accidental quotes from .env injection
  rawKey = rawKey.replace(/^"|"$/g, "");

  if (!rawKey) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured.");
  }

  if (rawKey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be exactly 64 hex characters.",
    );
  }

  return rawKey;
}
