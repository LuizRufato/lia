import { BadRequestException, ForbiddenException } from '@nestjs/common';

export type AdsAdminRole = 'OWNER' | 'ADMIN';

export function assertAdsAdmin(role: string): asserts role is AdsAdminRole {
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new ForbiddenException(
      'Somente OWNER ou ADMIN pode administrar o LIA Ads.',
    );
  }
}

export function parseAdsDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} inválido.`);
  }
  return date;
}

export function publicAdvertiserState(value: any) {
  return {
    name: value.name,
    status: value.status,
  };
}

export function publicCampaignState(value: any) {
  return {
    name: value.name,
    status: value.status,
    advertiserId: value.advertiserId,
    offerId: value.offerId,
    bidCpcCents: value.bidCpcCents,
    totalBudgetCents: value.totalBudgetCents,
    dailyBudgetCents: value.dailyBudgetCents,
    startAt: value.startAt,
    endAt: value.endAt,
  };
}
