import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param text The plaintext secret to encrypt.
 * @param masterKey A 32-byte (256-bit) master key.
 * @returns Object containing the encryptedSecret, iv, and authTag (all hex-encoded).
 */
export function encryptSecret(
  text: string,
  masterKey: string,
): { encryptedSecret: string; iv: string; authTag: string } {
  if (Buffer.from(masterKey, "hex").length !== 32) {
    throw new Error("Master key must be 32 bytes (64 hex characters).");
  }

  const iv = randomBytes(12); // Standard IV size for GCM
  const cipher = createCipheriv(ALGORITHM, Buffer.from(masterKey, "hex"), iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag().toString("hex");

  return {
    encryptedSecret: encrypted,
    iv: iv.toString("hex"),
    authTag,
  };
}

/**
 * Decrypts an encrypted string using AES-256-GCM.
 * @param encryptedSecret The encrypted payload (hex).
 * @param iv The initialization vector (hex).
 * @param authTag The GCM auth tag (hex).
 * @param masterKey A 32-byte (256-bit) master key.
 * @returns The decrypted plaintext.
 */
export function decryptSecret(
  encryptedSecret: string,
  iv: string,
  authTag: string,
  masterKey: string,
): string {
  if (Buffer.from(masterKey, "hex").length !== 32) {
    throw new Error("Master key must be 32 bytes (64 hex characters).");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    Buffer.from(masterKey, "hex"),
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encryptedSecret, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
