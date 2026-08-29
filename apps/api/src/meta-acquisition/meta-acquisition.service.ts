import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import {
  decryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';

const DEFAULT_CONFIG = {
  liaAdsEnabled: true,
  liaAdsMetaEnabled: false,
  liaAdsMetaWriteEnabled: false,
  liaAdsGroupRoutingEnabled: false,
  liaAdsGroupAutoProvisionEnabled: false,
  liaAdsAlertsEnabled: false,
  targetCostPerJoinCents: 100,
  minimumSpendBeforeAlertCents: 500,
  minimumJoinIntentsBeforeAlert: 10,
  groupCapacityDefault: 1024,
  groupPrepareThreshold: 900,
  groupRoutingThreshold: 1000,
  groupProvisioningMode: 'SHADOW' as const,
};

const CONCEPT_COPY: Record<string, { headline: string; primaryText: string }> =
  {
    AI_VALUE: {
      headline: 'Uma inteligência procurando ofertas por você.',
      primaryText:
        'A LIA analisa oportunidades reais e leva as melhores até você.',
    },
    SAVE_MONEY: {
      headline: 'Pare de pagar preço cheio.',
      primaryText:
        'Receba oportunidades verificadas e compre com mais contexto.',
    },
    URGENCY: {
      headline: 'A promoção aparece. Você vê primeiro.',
      primaryText: 'Acompanhe ofertas reais enquanto elas estão disponíveis.',
    },
    EXCLUSIVITY: {
      headline: 'Oportunidades selecionadas pela LIA.',
      primaryText: 'Entre gratuitamente para receber as descobertas da LIA.',
    },
    COMMUNITY: {
      headline: 'Uma comunidade que procura ofertas junta.',
      primaryText: 'Entre gratuitamente no grupo de ofertas da LIA Achou.',
    },
    PRICE_ALERT: {
      headline: 'Quando o preço muda, a LIA encontra.',
      primaryText: 'Receba alertas de oportunidades baseados em dados reais.',
    },
  };

function assertAdmin(role: string) {
  if (role !== 'OWNER' && role !== 'ADMIN') {
    throw new ForbiddenException(
      'Somente OWNER ou ADMIN pode alterar o LIA Ads.',
    );
  }
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${name} deve ser um inteiro positivo.`);
  }
  return parsed;
}

function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 6
    ? '••••'
    : `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function maskGroupJid(value: string): string {
  const [localPart, domain] = value.split('@');
  if (!localPart || !domain) return '••••';
  return `${localPart.slice(0, 3)}••••${localPart.slice(-4)}@${domain}`;
}

@Injectable()
export class MetaAcquisitionService {
  constructor(private readonly prisma: PrismaService) {}

  async discoverEvolutionGroups(tenantId: string, role: string) {
    assertAdmin(role);

    const integration = await this.prisma.channelIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'WHATSAPP' } },
      select: {
        transport: true,
        externalInstanceName: true,
        encryptedAccessToken: true,
        tokenIv: true,
        tokenAuthTag: true,
      },
    });

    if (
      !integration ||
      integration.transport !== 'WEB_UNOFFICIAL' ||
      !integration.externalInstanceName ||
      !integration.encryptedAccessToken ||
      !integration.tokenIv ||
      !integration.tokenAuthTag
    ) {
      throw new BadRequestException(
        'Evolution API integration not found or incomplete.',
      );
    }

    let token: string;
    try {
      token = decryptSecret(
        integration.encryptedAccessToken,
        integration.tokenIv,
        integration.tokenAuthTag,
        getEncryptionKey(),
      );
    } catch {
      throw new BadRequestException(
        'As credenciais da Evolution estão inválidas ou indisponíveis.',
      );
    }

    const provider = new WhatsAppEvolutionProvider();
    const state = await provider.getConnectionState(
      integration.externalInstanceName,
      token,
    );
    if (state !== 'open') {
      throw new BadRequestException(
        `Evolution API is not connected. State: ${state}`,
      );
    }

    const [groups, channels, registeredGroups] = await Promise.all([
      provider.fetchGroups(integration.externalInstanceName, token),
      this.prisma.channel.findMany({
        where: { tenantId, provider: 'WHATSAPP' },
        select: { id: true, externalChatId: true, enabled: true },
      }),
      this.prisma.liaWhatsAppGroup.findMany({
        where: { tenantId },
        select: { externalGroupJid: true },
      }),
    ]);

    const channelByJid = new Map(
      channels.map((channel) => [channel.externalChatId, channel]),
    );
    const registeredJids = new Set(
      registeredGroups.map((group) => group.externalGroupJid),
    );

    return {
      connected: true,
      groups: groups.map((group) => {
        const channel = channelByJid.get(group.id);
        return {
          externalGroupJid: maskGroupJid(group.id),
          subject: group.subject,
          participantCount: group.participants,
          matchedChannelId: channel?.id || null,
          channelEnabled: channel?.enabled ?? false,
          alreadyRegistered: registeredJids.has(group.id),
        };
      }),
    };
  }

  async config(tenantId: string) {
    const config = await this.prisma.metaAcquisitionConfig.findUnique({
      where: { tenantId },
    });
    return { ...DEFAULT_CONFIG, ...(config || {}) };
  }

  async overview(tenantId: string) {
    const [
      config,
      groups,
      events,
      groupEvents,
      activeCampaigns,
      openSuggestions,
      connection,
    ] = await Promise.all([
      this.config(tenantId),
      this.prisma.liaWhatsAppGroup.findMany({
        where: { tenantId },
        orderBy: { sequenceNumber: 'asc' },
        select: {
          id: true,
          name: true,
          status: true,
          capacity: true,
          memberCount: true,
          isRoutingActive: true,
          isPublicationActive: true,
          lastReconciledAt: true,
        },
      }),
      this.prisma.acquisitionEvent.findMany({
        where: { tenantId },
        select: { type: true, createdAt: true },
      }),
      this.prisma.liaWhatsAppGroupEvent.findMany({
        where: { tenantId, group: { NOT: { name: 'Teste' } } },
        select: { type: true, occurredAt: true },
      }),
      this.prisma.acquisitionCampaign.count({
        where: {
          tenantId,
          status: { in: ['APPROVED', 'EXECUTING', 'ACTIVE'] },
        },
      }),
      this.prisma.acquisitionSuggestion.count({
        where: { tenantId, status: 'OPEN' },
      }),
      this.prisma.metaConnection.findUnique({
        where: { tenantId },
        select: {
          status: true,
          businessId: true,
          adAccountId: true,
          pageId: true,
          instagramAccountId: true,
          tokenExpiresAt: true,
          permissions: true,
          lastValidatedAt: true,
          lastError: true,
        },
      }),
    ]);
    const officialGroups = groups.filter(
      (group) => group.name.trim().toLowerCase() !== 'teste',
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const countToday = (type: string) =>
      events.filter((event) => event.type === type && event.createdAt >= today)
        .length;
    const countGroupEvents = (type: string, since: Date) =>
      groupEvents.filter(
        (event) => event.type === type && event.occurredAt >= since,
      ).length;
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const joinsToday = countGroupEvents('JOIN', today);
    const leavesToday =
      countGroupEvents('LEAVE', today) + countGroupEvents('REMOVE', today);
    const totalMembers = officialGroups.reduce(
      (sum, group) => sum + group.memberCount,
      0,
    );
    const capacity = officialGroups.reduce(
      (sum, group) => sum + group.capacity,
      0,
    );
    return {
      objective: 'MEMBER_ACQUISITION',
      flags: {
        liaAdsEnabled: config.liaAdsEnabled,
        liaAdsMetaEnabled: config.liaAdsMetaEnabled,
        liaAdsMetaWriteEnabled: config.liaAdsMetaWriteEnabled,
        liaAdsGroupRoutingEnabled: config.liaAdsGroupRoutingEnabled,
        liaAdsGroupAutoProvisionEnabled: config.liaAdsGroupAutoProvisionEnabled,
        liaAdsAlertsEnabled: config.liaAdsAlertsEnabled,
      },
      members: {
        totalMembers,
        joinsToday,
        leavesToday,
        netGrowthToday: joinsToday - leavesToday,
        joins7d: countGroupEvents('JOIN', sevenDaysAgo),
        leaves7d:
          countGroupEvents('LEAVE', sevenDaysAgo) +
          countGroupEvents('REMOVE', sevenDaysAgo),
        netGrowth7d:
          countGroupEvents('JOIN', sevenDaysAgo) -
          countGroupEvents('LEAVE', sevenDaysAgo) -
          countGroupEvents('REMOVE', sevenDaysAgo),
        capacityUsed: totalMembers,
        remainingCapacity: Math.max(0, capacity - totalMembers),
        groups: officialGroups,
      },
      events: {
        landingViewsToday: countToday('LANDING_VIEW'),
        joinIntentsToday: countToday('JOIN_CTA_CLICK'),
        confirmedJoinsToday: joinsToday,
      },
      spend: { todayCents: null, totalCents: null, available: false },
      cpa: {
        targetCents: config.targetCostPerJoinCents,
        joinIntentCents: null,
        confirmedMemberCents: null,
        available: false,
      },
      activeCampaigns,
      openSuggestions,
      metaConnection: connection
        ? {
            status: connection.status,
            businessId: maskId(connection.businessId),
            adAccountId: maskId(connection.adAccountId),
            pageId: maskId(connection.pageId),
            instagramAccountId: maskId(connection.instagramAccountId),
            tokenExpiresAt: connection.tokenExpiresAt,
            permissions: connection.permissions,
            lastValidatedAt: connection.lastValidatedAt,
            lastError: connection.lastError,
          }
        : { status: 'NOT_CONFIGURED' },
    };
  }

  async listCampaigns(tenantId: string) {
    return this.prisma.acquisitionCampaign.findMany({
      where: { tenantId },
      include: {
        creatives: { select: { id: true, status: true, format: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTrackingLink(tenantId: string, role: string, body: any) {
    assertAdmin(role);
    const token = randomBytes(18).toString('base64url');
    return this.prisma.acquisitionTrackingLink.create({
      data: {
        tenantId,
        token,
        campaignId: body.campaignId || undefined,
        creativeId: body.creativeId || undefined,
        audienceStrategyId: body.audienceStrategyId || undefined,
        destinationGroupPool: 'LIA_ACHOU',
      },
      select: {
        id: true,
        token: true,
        campaignId: true,
        creativeId: true,
        audienceStrategyId: true,
        destinationGroupPool: true,
        active: true,
      },
    });
  }

  async groups(tenantId: string) {
    return this.prisma.liaWhatsAppGroup.findMany({
      where: { tenantId, NOT: { name: 'Teste' } },
      orderBy: { sequenceNumber: 'asc' },
      select: {
        id: true,
        name: true,
        sequenceNumber: true,
        status: true,
        capacity: true,
        memberCount: true,
        isRoutingActive: true,
        isPublicationActive: true,
        lastReconciledAt: true,
      },
    });
  }

  async createCampaign(
    tenantId: string,
    userId: string,
    role: string,
    body: any,
  ) {
    assertAdmin(role);
    const dailyBudgetCents = positiveInteger(
      body.dailyBudgetCents,
      'Orçamento diário',
    );
    const totalBudgetCents = body.totalBudgetCents
      ? positiveInteger(body.totalBudgetCents, 'Orçamento total')
      : undefined;
    if (totalBudgetCents && totalBudgetCents < dailyBudgetCents) {
      throw new BadRequestException(
        'Orçamento total não pode ser menor que o diário.',
      );
    }
    return this.prisma.acquisitionCampaign.create({
      data: {
        tenantId,
        createdByAdminUserId: userId,
        name: String(body.name || '').trim() || 'Campanha sem nome',
        dailyBudgetCents,
        totalBudgetCents,
        targetCostPerJoinCents: body.targetCostPerJoinCents
          ? positiveInteger(body.targetCostPerJoinCents, 'CPA alvo')
          : 100,
        startAt: body.startAt ? new Date(body.startAt) : undefined,
        endAt: body.endAt ? new Date(body.endAt) : undefined,
        country: 'BR',
        objective: 'MEMBER_ACQUISITION',
        status: 'DRAFT',
        destinationGroupPool: 'LIA_ACHOU',
      },
    });
  }

  async submitCampaign(tenantId: string, role: string, id: string) {
    assertAdmin(role);
    const campaign = await this.prisma.acquisitionCampaign.findFirst({
      where: { id, tenantId },
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.status !== 'DRAFT')
      throw new BadRequestException(
        'Somente rascunhos podem ser enviados para revisão.',
      );
    return this.prisma.acquisitionCampaign.update({
      where: { id },
      data: { status: 'READY_FOR_REVIEW' },
    });
  }

  async approveCampaign(
    tenantId: string,
    userId: string,
    role: string,
    id: string,
  ) {
    assertAdmin(role);
    const campaign = await this.prisma.acquisitionCampaign.findFirst({
      where: { id, tenantId },
      include: {
        creatives: { where: { status: 'APPROVED' }, select: { id: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    if (campaign.creatives.length === 0) {
      throw new BadRequestException(
        'A campanha precisa de pelo menos um criativo aprovado.',
      );
    }
    return this.prisma.acquisitionCampaign.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedByAdminUserId: userId,
        approvedAt: new Date(),
      },
    });
  }

  async listCreatives(tenantId: string) {
    return this.prisma.acquisitionCreative.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { campaign: { select: { id: true, name: true } } },
    });
  }

  async createCreative(tenantId: string, role: string, body: any) {
    assertAdmin(role);
    const concept = String(body.concept || 'AI_VALUE');
    const copy = CONCEPT_COPY[concept] || CONCEPT_COPY.AI_VALUE;
    const format = ['SQUARE', 'PORTRAIT', 'STORY'].includes(body.format)
      ? body.format
      : 'SQUARE';
    return this.prisma.acquisitionCreative.create({
      data: {
        tenantId,
        campaignId: body.campaignId || undefined,
        concept: concept as any,
        format: format as any,
        headline: String(body.headline || copy.headline),
        primaryText: String(body.primaryText || copy.primaryText),
        description: body.description ? String(body.description) : undefined,
        cta: String(body.cta || 'ENTRAR GRATUITAMENTE'),
        imagePrompt: `Objetivo: aquisição de membros. Ângulo: ${concept}. Identidade visual LIA, safe zone e CTA visual, sem claims falsos. Formato: ${format}.`,
        status: 'DRAFT',
      },
    });
  }

  async approveCreative(
    tenantId: string,
    userId: string,
    role: string,
    id: string,
  ) {
    assertAdmin(role);
    const creative = await this.prisma.acquisitionCreative.findFirst({
      where: { id, tenantId },
    });
    if (!creative) throw new NotFoundException('Criativo não encontrado.');
    return this.prisma.acquisitionCreative.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedByAdminUserId: userId,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    });
  }

  async rejectCreative(
    tenantId: string,
    role: string,
    id: string,
    reason?: string,
  ) {
    assertAdmin(role);
    const creative = await this.prisma.acquisitionCreative.findFirst({
      where: { id, tenantId },
    });
    if (!creative) throw new NotFoundException('Criativo não encontrado.');
    return this.prisma.acquisitionCreative.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: String(reason || 'Revisão necessária').slice(0, 500),
      },
    });
  }

  async analytics(tenantId: string) {
    const overview = await this.overview(tenantId);
    return {
      ...overview.events,
      ...overview.members,
      spend: overview.spend,
      definitions: {
        costPerJoinIntent: 'Gasto Meta / JOIN_CTA_CLICK',
        costPerConfirmedMember:
          'Gasto Meta / CONFIRMED_GROUP_JOIN, somente quando confiável',
        netMemberAcquisition: 'CONFIRMED_GROUP_JOIN - saídas confirmadas',
      },
      emptyState: overview.metaConnection.status !== 'CONNECTED',
    };
  }

  async suggestions(tenantId: string) {
    return this.prisma.acquisitionSuggestion.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async metaStatus(tenantId: string) {
    const connection = await this.prisma.metaConnection.findUnique({
      where: { tenantId },
    });
    if (!connection)
      return { status: 'NOT_CONFIGURED', configured: false, assets: [] };
    return {
      status: connection.status,
      configured: true,
      assets: {
        businessId: maskId(connection.businessId),
        adAccountId: maskId(connection.adAccountId),
        pageId: maskId(connection.pageId),
        instagramAccountId: maskId(connection.instagramAccountId),
      },
      permissions: connection.permissions,
      tokenExpiresAt: connection.tokenExpiresAt,
      lastValidatedAt: connection.lastValidatedAt,
      lastError: connection.lastError,
      writeEnabled: false,
    };
  }

  beginMetaOAuth(tenantId: string) {
    const appId = process.env.META_APP_ID;
    const redirectUri = process.env.META_REDIRECT_URI;
    if (!appId || !redirectUri) {
      return { configured: false, message: 'Meta ainda não configurada.' };
    }
    const state = randomBytes(32).toString('hex');
    MetaOAuthStateStore.set(state, {
      tenantId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      response_type: 'code',
      scope: 'ads_read',
    });
    return {
      configured: true,
      authorizationUrl: `https://www.facebook.com/v20.0/dialog/oauth?${params}`,
    };
  }

  consumeMetaOAuthState(state: string) {
    const record = MetaOAuthStateStore.get(state);
    MetaOAuthStateStore.delete(state);
    if (!record || record.expiresAt < Date.now()) {
      throw new BadRequestException('Estado OAuth inválido ou expirado.');
    }
    return { valid: true, tenantId: record.tenantId };
  }
}

const MetaOAuthStateStore = new Map<
  string,
  { tenantId: string; expiresAt: number }
>();

@Injectable()
export class GroupRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(tenantId: string, pool = 'LIA_ACHOU') {
    const config = await this.prisma.metaAcquisitionConfig.findUnique({
      where: { tenantId },
    });
    if (!config?.liaAdsGroupRoutingEnabled) {
      return { available: false, reason: 'ROUTING_DISABLED', pool };
    }
    const threshold =
      config?.groupRoutingThreshold ?? DEFAULT_CONFIG.groupRoutingThreshold;
    const group = await this.prisma.liaWhatsAppGroup.findFirst({
      where: {
        tenantId,
        NOT: { name: 'Teste' },
        status: 'ACTIVE',
        isRoutingActive: true,
        isPublicationActive: true,
        memberCount: { lt: threshold },
      },
      orderBy: { sequenceNumber: 'desc' },
      select: {
        id: true,
        name: true,
        inviteUrl: true,
        memberCount: true,
        capacity: true,
      },
    });
    if (
      !group ||
      !group.inviteUrl ||
      !/^https:\/\/chat\.whatsapp\.com\//i.test(group.inviteUrl)
    ) {
      return { available: false, reason: 'NO_ELIGIBLE_GROUP', pool };
    }
    return {
      available: true,
      pool,
      group: {
        id: group.id,
        name: group.name,
        inviteUrl: group.inviteUrl,
        memberCount: group.memberCount,
        capacity: group.capacity,
      },
    };
  }
}

@Injectable()
export class GroupProvisioningService {
  async plan(tenantId: string, memberCount: number, threshold: number) {
    return {
      tenantId,
      mode: 'SHADOW',
      shouldProvision: memberCount >= threshold,
      action:
        memberCount >= threshold ? 'NEW_GROUP_WOULD_BE_CREATED' : 'NO_ACTION',
      executed: false,
    };
  }
}
