import { encryptSecret, decryptSecret } from "./encryption";
import { randomBytes } from "crypto";

describe("Encryption", () => {
  it("encrypts and decrypts secrets correctly", () => {
    const masterKey = randomBytes(32).toString("hex");
    const secret = "my-super-secret-app-key-123";

    const { encryptedSecret, iv, authTag } = encryptSecret(secret, masterKey);

    expect(encryptedSecret).toBeDefined();
    expect(iv).toBeDefined();
    expect(authTag).toBeDefined();
    expect(encryptedSecret).not.toContain(secret);

    const decrypted = decryptSecret(encryptedSecret, iv, authTag, masterKey);
    expect(decrypted).toEqual(secret);
  });

  it("fails decryption with wrong key", () => {
    const masterKey = randomBytes(32).toString("hex");
    const wrongKey = randomBytes(32).toString("hex");
    const secret = "test-secret";

    const { encryptedSecret, iv, authTag } = encryptSecret(secret, masterKey);

    expect(() => {
      decryptSecret(encryptedSecret, iv, authTag, wrongKey);
    }).toThrow();
  });
});
