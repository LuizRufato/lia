import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AdsAuditService } from './ads-audit.service';
import { AddCreditDto } from './dto/ads.dto';
import { assertAdsAdmin } from './ads.utils';

@Injectable()
export class AdsFinancialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdsAuditService,
  ) {}

  async dashboard(tenantId: string) {
    const [
      advertisersCount,
      activeCampaigns,
      pendingReviewCampaigns,
      credits,
      charges,
      balance,
    ] = await Promise.all([
      this.prisma.advertiser.count({ where: { tenantId } }),
      this.prisma.adCampaign.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.adCampaign.count({
        where: { tenantId, status: 'PENDING_REVIEW' },
      }),
      this.prisma.adBillingEvent.aggregate({
        where: { tenantId, type: 'CREDIT' },
        _sum: { amountCents: true },
      }),
      this.prisma.adBillingEvent.aggregate({
        where: { tenantId, type: 'CHARGE' },
        _sum: { amountCents: true },
      }),
      this.prisma.advertiserBalance.aggregate({
        where: { tenantId },
        _sum: { availableCents: true },
      }),
    ]);
    const totalCreditsCents = credits._sum.amountCents ?? 0;
    const totalChargesCents = charges._sum.amountCents ?? 0;
    return {
      advertisersCount,
      activeCampaigns,
      pendingReviewCampaigns,
      totalCreditsCents,
      totalChargesCents,
      adRevenueCents: totalChargesCents,
      availableBalanceCents: balance._sum.availableCents ?? 0,
      clicks: 0,
      billableClicks: 0,
      deliveryEnabled: false,
    };
  }

  async ledger(tenantId: string, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
    const where: any = { tenantId };
    if (query.advertiserId) where.advertiserId = query.advertiserId;
    const [total, items] = await Promise.all([
      this.prisma.adBillingEvent.count({ where }),
      this.prisma.adBillingEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          advertiser: { select: { id: true, name: true } },
          campaign: { select: { id: true, name: true } },
        },
      }),
    ]);
    return {
      data: items.map((item) => ({
        id: item.id,
        type: item.type,
        amountCents: item.amountCents,
        currency: item.currency,
        reason: item.reason,
        idempotencyKey: item.idempotencyKey,
        advertiser: item.advertiser,
        campaign: item.campaign,
        createdAt: item.createdAt,
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async addCredit(
    tenantId: string,
    adminUserId: string,
    role: string,
    advertiserId: string,
    body: AddCreditDto,
  ) {
    assertAdsAdmin(role);
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) {
      throw new BadRequestException(
        'O crédito deve ser um valor inteiro positivo em centavos.',
      );
    }
    if (!body.reason.trim())
      throw new BadRequestException('Informe o motivo do crédito.');
    if (!body.idempotencyKey.trim())
      throw new BadRequestException('Idempotency key é obrigatória.');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const advertiser = await tx.advertiser.findFirst({
          where: { id: advertiserId, tenantId },
        });
        if (!advertiser)
          throw new NotFoundException('Anunciante não encontrado.');
        const existing = await tx.adBillingEvent.findUnique({
          where: { idempotencyKey: body.idempotencyKey.trim() },
        });
        if (existing) {
          if (
            existing.tenantId !== tenantId ||
            existing.advertiserId !== advertiserId
          ) {
            throw new BadRequestException(
              'Idempotency key já utilizada em outro contexto.',
            );
          }
          return {
            status: 'DUPLICATE',
            eventId: existing.id,
            amountCents: existing.amountCents,
            balanceChanged: false,
          };
        }

        const event = await tx.adBillingEvent.create({
          data: {
            tenantId,
            advertiserId,
            type: 'CREDIT',
            direction: 'POSITIVE',
            amountCents: body.amountCents,
            currency: 'BRL',
            idempotencyKey: body.idempotencyKey.trim(),
            adminUserId,
            reason: body.reason.trim(),
          },
        });
        const balance = await tx.advertiserBalance.upsert({
          where: { advertiserId },
          create: {
            tenantId,
            advertiserId,
            availableCents: body.amountCents,
            version: 1,
          },
          update: {
            availableCents: { increment: body.amountCents },
            version: { increment: 1 },
          },
        });
        await this.audit.record(tx, {
          tenantId,
          advertiserId,
          adminUserId,
          action: 'CREDIT_ADDED',
          entityType: 'AdBillingEvent',
          entityId: event.id,
          newState: {
            type: 'CREDIT',
            amountCents: body.amountCents,
            balanceAvailableCents: balance.availableCents,
          },
          metadata: { idempotencyKey: body.idempotencyKey.trim() },
        });
        return {
          status: 'CREATED',
          eventId: event.id,
          amountCents: event.amountCents,
          balanceChanged: true,
          availableCents: balance.availableCents,
        };
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existing = await this.prisma.adBillingEvent.findUnique({
          where: { idempotencyKey: body.idempotencyKey.trim() },
        });
        if (
          existing?.tenantId === tenantId &&
          existing.advertiserId === advertiserId
        ) {
          return {
            status: 'DUPLICATE',
            eventId: existing.id,
            amountCents: existing.amountCents,
            balanceChanged: false,
          };
        }
      }
      throw error;
    }
  }
}
