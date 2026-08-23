import { createHash } from 'crypto';

export type NormalizedOrderStatus =
  | 'UNPAID'
  | 'PENDING'
  | 'COMPLETED'
  | 'CANCELLED';

export type CommissionStatus =
  | 'ESTIMATED'
  | 'PENDING'
  | 'CONFIRMED'
  | 'CANCELLED';

/**
 * Shopee can use a small set of equivalent labels across report versions.
 * Unknown values remain conservative (PENDING) and are never counted as paid.
 */
export function normalizeOrderStatus(value: unknown): NormalizedOrderStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  switch (normalized) {
    case 'UNPAID':
      return 'UNPAID';
    case 'COMPLETED':
    case 'COMPLETE':
    case 'PAID':
      return 'COMPLETED';
    case 'CANCELLED':
    case 'CANCELED':
    case 'CANCEL':
      return 'CANCELLED';
    case 'PENDING':
    case 'IN_PROGRESS':
    case 'PROCESSING':
    default:
      return 'PENDING';
  }
}

export function deriveCommissionStatus(
  statuses: NormalizedOrderStatus[],
): CommissionStatus {
  if (statuses.length === 0 || statuses.every((status) => status === 'UNPAID')) {
    return 'ESTIMATED';
  }
  if (statuses.some((status) => status === 'COMPLETED')) {
    return 'CONFIRMED';
  }
  if (statuses.every((status) => status === 'CANCELLED')) {
    return 'CANCELLED';
  }
  return 'PENDING';
}

export function conversionPageJobId(
  tenantId: string,
  purchaseTimeStart: number,
  purchaseTimeEnd: number,
  scrollId?: string,
) {
  const cursor = scrollId
    ? createHash('sha256').update(scrollId).digest('hex').slice(0, 16)
    : 'initial';
  return `shopee-conv-${tenantId}-${purchaseTimeStart}-${purchaseTimeEnd}-${cursor}`;
}
