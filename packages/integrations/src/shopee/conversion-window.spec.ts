import {
  getShopeeConversionWindow,
  isRetryableShopeeConversionError,
  SHOPEE_CONVERSION_OVERLAP_SECONDS,
} from "./conversion-window";

describe("Shopee conversion window", () => {
  it("uses the bounded initial lookback when there is no successful sync", () => {
    expect(getShopeeConversionWindow(null, 1_700_000_000, 86_400)).toEqual({
      purchaseTimeStart: 1_699_913_600,
      purchaseTimeEnd: 1_700_000_000,
    });
  });

  it("uses a small overlap after a successful sync", () => {
    const last = new Date(1_700_000_000 * 1000);
    const window = getShopeeConversionWindow(last, 1_700_000_300);

    expect(window.purchaseTimeStart).toBe(
      1_700_000_000 - SHOPEE_CONVERSION_OVERLAP_SECONDS,
    );
    expect(window.purchaseTimeEnd).toBe(1_700_000_300);
  });

  it("classifies rate limits, timeouts and transient HTTP errors for retry", () => {
    expect(isRetryableShopeeConversionError({ code: 10030 })).toBe(true);
    expect(isRetryableShopeeConversionError({ status: 429 })).toBe(true);
    expect(isRetryableShopeeConversionError(new Error("request timeout"))).toBe(
      true,
    );
    expect(isRetryableShopeeConversionError(new Error("cursor expired"))).toBe(
      true,
    );
    expect(isRetryableShopeeConversionError({ status: 400 })).toBe(false);
  });
});
