import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AdCampaignStatus } from '@prisma/client';
import { AdsAuditService } from './ads-audit.service';
import {
  CreateCampaignDto,
  RejectCampaignDto,
  UpdateCampaignDto,
} from './dto/ads.dto';
import { assertAdsAdmin, parseAdsDate, publicCampaignState } from './ads.utils';

const campaignInclude = {
  advertiser: { select: { id: true, name: true, status: true } },
  offer: {
    select: {
      id: true,
      title: true,
      price: true,
      imageUrl: true,
      status: true,
      marketplace: { select: { type: true } },
    },
  },
} as const;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdsAuditService,
  ) {}

  async list(tenantId: string, query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const where: any = { tenantId };
    if (query.status) where.status = query.status;
    if (query.advertiserId) where.advertiserId = query.advertiserId;

    const [total, campaigns] = await Promise.all([
      this.prisma.adCampaign.count({ where }),
      this.prisma.adCampaign.findMany({
        where,
        include: campaignInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: campaigns.map((campaign) => this.toView(campaign)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async get(tenantId: string, id: string) {
    const campaign = await this.prisma.adCampaign.findFirst({
      where: { id, tenantId },
      include: campaignInclude,
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    return this.toView(campaign);
  }

  async create(
    tenantId: string,
    adminUserId: string,
    role: string,
    body: CreateCampaignDto,
  ) {
    assertAdsAdmin(role);
    if (!body.name.trim()) {
      throw new BadRequestException('Nome da campanha é obrigatório.');
    }
    const advertiser = await this.requireAdvertiser(
      tenantId,
      body.advertiserId,
    );
    const offer = await this.requireShopeeOffer(tenantId, body.offerId);
    const values = this.validateValues(body);

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.adCampaign.create({
        data: {
          tenantId,
          advertiserId: advertiser.id,
          name: body.name.trim(),
          marketplace: 'SHOPEE',
          placement: 'PUBLIC_SEARCH',
          offerId: offer.id,
          pricingModel: 'CPC',
          ...values,
        },
        include: campaignInclude,
      });
      await this.audit.record(tx, {
        tenantId,
        advertiserId: advertiser.id,
        campaignId: created.id,
        adminUserId,
        action: 'CAMPAIGN_CREATED',
        entityType: 'AdCampaign',
        entityId: created.id,
        newState: publicCampaignState(created),
      });
      return created;
    });
    return this.toView(campaign);
  }

  async update(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
    body: UpdateCampaignDto,
  ) {
    assertAdsAdmin(role);
    const existing = await this.requireCampaign(tenantId, id);
    if (!['DRAFT', 'PENDING_REVIEW'].includes(existing.status)) {
      throw new BadRequestException(
        'Campanhas aprovadas devem voltar ao fluxo de revisão antes de alterações materiais.',
      );
    }
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Nome da campanha é obrigatório.');
    }
    const advertiser = body.advertiserId
      ? await this.requireAdvertiser(tenantId, body.advertiserId)
      : null;
    const offer = body.offerId
      ? await this.requireShopeeOffer(tenantId, body.offerId)
      : null;
    const values = this.validateValues({
      bidCpcCents: body.bidCpcCents ?? existing.bidCpcCents,
      totalBudgetCents: body.totalBudgetCents ?? existing.totalBudgetCents,
      dailyBudgetCents: body.dailyBudgetCents ?? existing.dailyBudgetCents,
      startAt: body.startAt ?? existing.startAt.toISOString(),
      endAt: body.endAt ?? existing.endAt.toISOString(),
    });

    const campaign = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.adCampaign.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(advertiser && { advertiserId: advertiser.id }),
          ...(offer && { offerId: offer.id }),
          ...values,
        },
        include: campaignInclude,
      });
      await this.audit.record(tx, {
        tenantId,
        advertiserId: updated.advertiserId,
        campaignId: id,
        adminUserId,
        action: 'CAMPAIGN_UPDATED',
        entityType: 'AdCampaign',
        entityId: id,
        previousState: publicCampaignState(existing),
        newState: publicCampaignState(updated),
      });
      return updated;
    });
    return this.toView(campaign);
  }

  async submit(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
  ) {
    assertAdsAdmin(role);
    const campaign = await this.requireCampaign(tenantId, id);
    this.transition(campaign.status, 'DRAFT');
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.adCampaign.update({
        where: { id },
        data: { status: 'PENDING_REVIEW', submittedAt: new Date() },
        include: campaignInclude,
      });
      await this.recordTransition(
        tx,
        tenantId,
        adminUserId,
        value,
        campaign,
        'CAMPAIGN_SUBMITTED',
      );
      return value;
    });
    return this.toView(updated);
  }

  async approve(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
  ) {
    assertAdsAdmin(role);
    const campaign = await this.requireCampaign(tenantId, id);
    this.transition(campaign.status, 'PENDING_REVIEW');
    const advertiser = await this.requireAdvertiser(
      tenantId,
      campaign.advertiserId,
    );
    if (advertiser.status !== 'ACTIVE')
      throw new BadRequestException(
        'Anunciante suspenso não pode ativar campanha.',
      );
    await this.requireShopeeOffer(tenantId, campaign.offerId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.adCampaign.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          approvedAt: new Date(),
          approvedByAdminUserId: adminUserId,
          rejectedAt: null,
          rejectedByAdminUserId: null,
          rejectionReason: null,
        },
        include: campaignInclude,
      });
      await this.recordTransition(
        tx,
        tenantId,
        adminUserId,
        value,
        campaign,
        'CAMPAIGN_APPROVED',
      );
      return value;
    });
    return this.toView(updated);
  }

  async reject(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
    body: RejectCampaignDto,
  ) {
    assertAdsAdmin(role);
    const campaign = await this.requireCampaign(tenantId, id);
    this.transition(campaign.status, 'PENDING_REVIEW');
    const reason = body.reason.trim();
    if (!reason) throw new BadRequestException('Informe o motivo da rejeição.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.adCampaign.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
          rejectedByAdminUserId: adminUserId,
          rejectionReason: reason,
        },
        include: campaignInclude,
      });
      await this.recordTransition(
        tx,
        tenantId,
        adminUserId,
        value,
        campaign,
        'CAMPAIGN_REJECTED',
      );
      return value;
    });
    return this.toView(updated);
  }

  async pause(tenantId: string, adminUserId: string, role: string, id: string) {
    return this.simpleTransition(
      tenantId,
      adminUserId,
      role,
      id,
      'ACTIVE',
      'PAUSED',
      'CAMPAIGN_PAUSED',
    );
  }

  async resume(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
  ) {
    return this.simpleTransition(
      tenantId,
      adminUserId,
      role,
      id,
      'PAUSED',
      'ACTIVE',
      'CAMPAIGN_RESUMED',
    );
  }

  private async simpleTransition(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
    from: AdCampaignStatus,
    to: AdCampaignStatus,
    action: string,
  ) {
    assertAdsAdmin(role);
    const campaign = await this.requireCampaign(tenantId, id);
    this.transition(campaign.status, from);
    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.adCampaign.update({
        where: { id },
        data: { status: to },
        include: campaignInclude,
      });
      await this.recordTransition(
        tx,
        tenantId,
        adminUserId,
        value,
        campaign,
        action,
      );
      return value;
    });
    return this.toView(updated);
  }

  private async recordTransition(
    tx: any,
    tenantId: string,
    adminUserId: string,
    next: any,
    previous: any,
    action: string,
  ) {
    await this.audit.record(tx, {
      tenantId,
      advertiserId: next.advertiserId,
      campaignId: next.id,
      adminUserId,
      action,
      entityType: 'AdCampaign',
      entityId: next.id,
      previousState: publicCampaignState(previous),
      newState: publicCampaignState(next),
    });
  }

  private async requireCampaign(tenantId: string, id: string) {
    const campaign = await this.prisma.adCampaign.findFirst({
      where: { id, tenantId },
      include: campaignInclude,
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    return campaign;
  }

  private async requireAdvertiser(tenantId: string, id: string) {
    const advertiser = await this.prisma.advertiser.findFirst({
      where: { id, tenantId },
    });
    if (!advertiser) throw new NotFoundException('Anunciante não encontrado.');
    return advertiser;
  }

  private async requireShopeeOffer(tenantId: string, id: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, tenantId },
      include: { marketplace: { select: { type: true } } },
    });
    if (!offer) throw new NotFoundException('Offer não encontrada.');
    if (
      offer.marketplace.type !== 'SHOPEE' ||
      offer.status !== 'ACTIVE' ||
      !offer.title.trim() ||
      !offer.externalId.trim() ||
      !/^https:\/\//i.test(offer.url)
    ) {
      throw new BadRequestException(
        'A campanha exige uma Offer Shopee ativa com identidade e URL HTTPS válidas.',
      );
    }
    return offer;
  }

  private validateValues(body: {
    bidCpcCents: number;
    totalBudgetCents: number;
    dailyBudgetCents: number;
    startAt: string;
    endAt: string;
  }) {
    if (!Number.isSafeInteger(body.bidCpcCents) || body.bidCpcCents <= 0)
      throw new BadRequestException('CPC inválido.');
    if (
      !Number.isSafeInteger(body.totalBudgetCents) ||
      body.totalBudgetCents <= 0
    )
      throw new BadRequestException('Orçamento total inválido.');
    if (
      !Number.isSafeInteger(body.dailyBudgetCents) ||
      body.dailyBudgetCents <= 0 ||
      body.dailyBudgetCents > body.totalBudgetCents
    )
      throw new BadRequestException('Orçamento diário inválido.');
    const startAt =
      typeof body.startAt === 'string'
        ? parseAdsDate(body.startAt, 'startAt')
        : body.startAt;
    const endAt =
      typeof body.endAt === 'string'
        ? parseAdsDate(body.endAt, 'endAt')
        : body.endAt;
    if (endAt <= startAt)
      throw new BadRequestException('endAt deve ser posterior a startAt.');
    return {
      bidCpcCents: body.bidCpcCents,
      totalBudgetCents: body.totalBudgetCents,
      dailyBudgetCents: body.dailyBudgetCents,
      startAt,
      endAt,
    };
  }

  private transition(actual: string, expected: AdCampaignStatus) {
    if (actual !== expected)
      throw new BadRequestException(
        `Transição inválida: ${actual} → ${expected}.`,
      );
  }

  private toView(campaign: any) {
    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      marketplace: campaign.marketplace,
      placement: campaign.placement,
      pricingModel: campaign.pricingModel,
      bidCpcCents: campaign.bidCpcCents,
      totalBudgetCents: campaign.totalBudgetCents,
      dailyBudgetCents: campaign.dailyBudgetCents,
      startAt: campaign.startAt,
      endAt: campaign.endAt,
      submittedAt: campaign.submittedAt,
      approvedAt: campaign.approvedAt,
      rejectionReason: campaign.rejectionReason,
      advertiser: campaign.advertiser,
      offer: campaign.offer,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt,
    };
  }
}
