export const SHOPEE_CONVERSION_INTERVAL_MS = 5 * 60 * 1000;
export const SHOPEE_CONVERSION_CURSOR_DELAY_MS = 20 * 1000;
export const SHOPEE_CONVERSION_MAX_PAGES = 50;
export const SHOPEE_CONVERSION_OVERLAP_SECONDS = 15 * 60;
export const SHOPEE_CONVERSION_INITIAL_LOOKBACK_SECONDS = 7 * 24 * 60 * 60;

export interface ShopeeConversionWindow {
  purchaseTimeStart: number;
  purchaseTimeEnd: number;
}

export function getShopeeConversionWindow(
  lastSuccessfulSyncAt: Date | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  initialLookbackSeconds = SHOPEE_CONVERSION_INITIAL_LOOKBACK_SECONDS,
): ShopeeConversionWindow {
  const end = Math.max(0, Math.floor(nowSeconds));
  const last = lastSuccessfulSyncAt
    ? Math.floor(lastSuccessfulSyncAt.getTime() / 1000)
    : null;

  if (last === null || !Number.isFinite(last)) {
    return {
      purchaseTimeStart: Math.max(0, end - initialLookbackSeconds),
      purchaseTimeEnd: end,
    };
  }

  return {
    purchaseTimeStart: Math.max(
      0,
      Math.min(last, end) - SHOPEE_CONVERSION_OVERLAP_SECONDS,
    ),
    purchaseTimeEnd: end,
  };
}

export function isRetryableShopeeConversionError(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  const code = String(candidate?.code ?? "").toUpperCase();
  const status = Number(candidate?.status);
  const message = String(candidate?.message ?? "").toLowerCase();
  const isExpiredCursor =
    (message.includes("scrollid") ||
      message.includes("scroll_id") ||
      message.includes("cursor")) &&
    (message.includes("expire") ||
      message.includes("invalid") ||
      message.includes("not found"));

  return (
    code === "10030" ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    isExpiredCursor
  );
}
