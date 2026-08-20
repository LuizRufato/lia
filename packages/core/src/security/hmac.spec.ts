import { generateVisitorHash } from "./hmac";

describe("Visitor Hashing", () => {
  it("HMAC mesmo visitante mesmo dia = igual", () => {
    const date = new Date("2026-08-07T12:00:00Z");
    const hash1 = generateVisitorHash(
      "Mozilla/5.0",
      "192.168.1.1",
      date,
      "secret",
    );
    const hash2 = generateVisitorHash(
      "Mozilla/5.0",
      "192.168.1.1",
      date,
      "secret",
    );
    expect(hash1).toEqual(hash2);
  });

  it("HMAC mesmo visitante outro dia = diferente", () => {
    const date1 = new Date("2026-08-07T12:00:00Z");
    const date2 = new Date("2026-08-08T12:00:00Z");
    const hash1 = generateVisitorHash(
      "Mozilla/5.0",
      "192.168.1.1",
      date1,
      "secret",
    );
    const hash2 = generateVisitorHash(
      "Mozilla/5.0",
      "192.168.1.1",
      date2,
      "secret",
    );
    expect(hash1).not.toEqual(hash2);
  });
});
