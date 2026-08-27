import { startOfLocalDay } from "./timezone";

export interface CatalogPublicationRecord {
  tenantId: string;
  channelId: string;
  externalId: string;
  productIdentity?: string;
  category: string | null;
  status: "PUBLISHED" | "DELIVERY_UNKNOWN" | string;
  createdAt: Date;
  publishedAt: Date | null;
}

export function findProductCooldown(
  records: CatalogPublicationRecord[],
  input: {
    tenantId: string;
    channelId: string;
    externalId: string;
    productIdentity?: string;
    now: Date;
    cooldownHours: number;
  },
): { active: boolean; until: Date | null } {
  const cutoff = input.now.getTime() - input.cooldownHours * 60 * 60 * 1000;
  const identity = input.productIdentity || input.externalId;
  const match = records
    .filter(
      (record) =>
        record.tenantId === input.tenantId &&
        record.channelId === input.channelId &&
        (record.productIdentity || record.externalId) === identity &&
        record.status === "PUBLISHED" &&
        (record.publishedAt || record.createdAt).getTime() >= cutoff,
    )
    .sort(
      (a, b) =>
        (b.publishedAt || b.createdAt).getTime() -
        (a.publishedAt || a.createdAt).getTime(),
    )[0];

  return match
    ? {
        active: true,
        until: new Date(
          (match.publishedAt || match.createdAt).getTime() +
            input.cooldownHours * 60 * 60 * 1000,
        ),
      }
    : { active: false, until: null };
}

export function countCategoryPublicationsToday(
  records: CatalogPublicationRecord[],
  input: {
    tenantId: string;
    channelId: string;
    category: string | null;
    now: Date;
    timezone: string;
  },
): number {
  if (!input.category) return 0;
  const dayStart = startOfLocalDay(input.now, input.timezone);
  return records.filter(
    (record) =>
      record.tenantId === input.tenantId &&
      record.channelId === input.channelId &&
      record.category === input.category &&
      ["PUBLISHED", "DELIVERY_UNKNOWN"].includes(record.status) &&
      (record.publishedAt ?? record.createdAt) >= dayStart &&
      (record.publishedAt ?? record.createdAt) <= input.now,
  ).length;
}
