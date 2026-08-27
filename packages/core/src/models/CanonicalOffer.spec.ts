import { firstHttpsImageUrl } from "./CanonicalOffer";

describe("firstHttpsImageUrl", () => {
  it("returns the first real HTTPS image", () => {
    expect(firstHttpsImageUrl(["https://cdn.example/image.jpg"])).toBe(
      "https://cdn.example/image.jpg",
    );
  });

  it("returns null when no image is available", () => {
    expect(firstHttpsImageUrl([])).toBeNull();
    expect(firstHttpsImageUrl(undefined)).toBeNull();
  });

  it("rejects private HTTPS targets before a provider can fetch them", () => {
    expect(
      firstHttpsImageUrl([
        "https://127.0.0.1/image.jpg",
        "https://localhost/image.jpg",
        "https://cdn.example/image.jpg",
      ]),
    ).toBe("https://cdn.example/image.jpg");
  });

  it("rejects non-HTTPS and malformed image URLs", () => {
    expect(
      firstHttpsImageUrl([
        "http://cdn.example/image.jpg",
        "javascript:alert(1)",
        "data:image/png;base64,abc",
        "not-a-url",
      ]),
    ).toBeNull();
  });
});
