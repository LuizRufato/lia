import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  CopyEngine,
  DEFAULT_PUBLICATION_TEMPLATES,
  PUBLICATION_TEMPLATE_VARIABLES,
  PublicationCopyContext,
} from '@lia/core';

const TYPES = ['ACHADINHO', 'OFERTA', 'PRECO_CAIU', 'MAIS_VENDIDO', 'GENERIC'];
const CTA_MODES = ['AUTO', 'CUSTOM'];

type TemplateRow = {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  body: string;
  enabled: boolean;
  isDefault: boolean;
  createdAt: Date;
};

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private validate(payload: any) {
    const name =
      typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '';
    const body =
      typeof payload.body === 'string'
        ? payload.body.trim().slice(0, 4000)
        : '';
    const type = payload.type;
    const ctaMode = payload.ctaMode || 'AUTO';
    if (
      !name ||
      !body ||
      !TYPES.includes(type) ||
      !CTA_MODES.includes(ctaMode)
    ) {
      throw new BadRequestException('Template inválido.');
    }
    const customCta =
      ctaMode === 'CUSTOM' && typeof payload.customCta === 'string'
        ? payload.customCta
            .replace(/[\r\n]+/g, ' ')
            .replace(/[<>]/g, '')
            .trim()
            .slice(0, 120)
        : null;
    if (ctaMode === 'CUSTOM' && !customCta) {
      throw new BadRequestException('CTA personalizado não pode ficar vazio.');
    }
    return {
      name,
      body,
      type,
      ctaMode,
      customCta,
      enabled: payload.enabled !== false,
      isDefault: payload.isDefault === true,
      priority: Number.isInteger(payload.priority) ? payload.priority : 0,
    };
  }

  private templateKey(template: { type: string; name: string; body: string }) {
    return `${template.type}\u0000${template.name}\u0000${template.body}`;
  }

  private async dedupeDefaultTemplates(client: any, tenantId: string) {
    const defaultKeys = new Set(
      DEFAULT_PUBLICATION_TEMPLATES.map((template) =>
        this.templateKey(template),
      ),
    );
    const templates = (await client.findMany({
      where: { tenantId },
      orderBy: [
        { isDefault: 'desc' },
        { enabled: 'desc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
    })) as TemplateRow[];
    const seen = new Set<string>();
    const duplicateIds: string[] = [];

    for (const template of templates) {
      const key = this.templateKey(template);
      if (!defaultKeys.has(key)) continue;
      if (seen.has(key)) duplicateIds.push(template.id);
      else seen.add(key);
    }

    if (duplicateIds.length > 0) {
      await client.deleteMany({
        where: { tenantId, id: { in: duplicateIds } },
      });
    }

    return duplicateIds.length;
  }

  private async ensureDefaults(tenantId: string) {
    await this.prisma.$transaction(async (tx: any) => {
      const client = tx.publicationTemplate;
      await this.dedupeDefaultTemplates(client, tenantId);
      const count = await client.count({ where: { tenantId } });
      if (count === 0) {
        await client.createMany({
          data: DEFAULT_PUBLICATION_TEMPLATES.map((template) => ({
            ...template,
            tenantId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }

  async list(tenantId: string) {
    await this.ensureDefaults(tenantId);
    return (this.prisma as any).publicationTemplate.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(tenantId: string, payload: any) {
    const data = this.validate(payload);
    return this.prisma.$transaction(async (tx: any) => {
      if (data.isDefault) {
        await tx.publicationTemplate.updateMany({
          where: { tenantId },
          data: { isDefault: false },
        });
      }
      return tx.publicationTemplate.create({ data: { ...data, tenantId } });
    });
  }

  async update(tenantId: string, id: string, payload: any) {
    const existing = await (this.prisma as any).publicationTemplate.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Template não encontrado.');
    const data = this.validate({ ...existing, ...payload });
    return this.prisma.$transaction(async (tx: any) => {
      if (data.isDefault) {
        await tx.publicationTemplate.updateMany({
          where: { tenantId, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.publicationTemplate.update({ where: { id }, data });
    });
  }

  async preview(tenantId: string) {
    const templates = await this.list(tenantId);
    const offers = await this.prisma.offer.findMany({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        marketplace: true,
        priceHistories: { orderBy: { observedAt: 'desc' }, take: 20 },
      },
    });
    const contextFor = (offer: any): PublicationCopyContext => {
      const histories = offer.priceHistories || [];
      return {
        title: offer.title,
        priceCents: offer.price,
        currentOriginalPriceCents: histories[0]?.originalPriceCents ?? null,
        currentObservedAt: histories[0]?.observedAt ?? offer.updatedAt,
        previousPrices: histories.slice(1),
        discountBps: histories[0]?.discountBps ?? null,
        salesCount: histories[0]?.salesCount ?? null,
        rating: histories[0]?.rating ?? null,
        marketplace: offer.marketplace.name || offer.marketplace.type,
        finalLink: 'https://go.botlia.com.br/preview',
        locale: 'pt-BR',
        currency: 'BRL',
      };
    };
    const representativeOffer = (type: string) => {
      if (type === 'PRECO_CAIU') {
        return offers.find(
          (offer: any) =>
            CopyEngine.render(
              { ...DEFAULT_PUBLICATION_TEMPLATES[2], body: '{preco_antigo}' },
              contextFor(offer),
            ).previousPriceCents != null,
        );
      }
      if (type === 'MAIS_VENDIDO') {
        return offers.find(
          (offer: any) =>
            Number.isInteger(offer.priceHistories?.[0]?.salesCount) &&
            offer.priceHistories[0].salesCount >= 100,
        );
      }
      return offers[0];
    };
    const realPreviews = templates.map((template: any) => {
      const offer = representativeOffer(template.type);
      if (!offer) {
        return {
          id: template.id,
          name: template.name,
          type: template.type,
          available: false,
          rendered: null,
          message:
            'Não há uma oferta real recente com os dados necessários para demonstrar este template.',
          variablesAvailable: null,
        };
      }
      const rendered = CopyEngine.render(template, contextFor(offer));
      const context = contextFor(offer);
      return {
        id: template.id,
        name: template.name,
        type: template.type,
        available: true,
        rendered: rendered.text,
        variablesAvailable: {
          titulo: Boolean(context.title?.trim()),
          preco_atual: Number.isInteger(context.priceCents),
          preco_antigo: rendered.previousPriceCents != null,
          desconto: rendered.discountPercentage != null,
          cta: true,
          link: Boolean(context.finalLink),
          marketplace: Boolean(context.marketplace),
          sales_count:
            Number.isInteger(context.salesCount) &&
            (context.salesCount as number) >= 0,
          rating:
            typeof context.rating === 'number' &&
            Number.isFinite(context.rating) &&
            context.rating >= 0 &&
            context.rating <= 5,
        },
        offer: { title: offer.title, priceCents: offer.price },
      };
    });
    const demoContext: PublicationCopyContext = {
      title: 'Smartphone Exemplo LIA',
      priceCents: 79990,
      currentOriginalPriceCents: 99990,
      discountBps: 2000,
      salesCount: 1250,
      rating: 4.8,
      marketplace: 'Shopee',
      finalLink: 'https://go.botlia.com.br/preview',
      locale: 'pt-BR',
      currency: 'BRL',
    };
    const layoutPreviews = templates.map((template: any) => ({
      id: template.id,
      name: template.name,
      type: template.type,
      rendered: CopyEngine.render(template, demoContext).text,
    }));
    return {
      isDemo: false,
      variables: PUBLICATION_TEMPLATE_VARIABLES,
      previews: realPreviews,
      realPreviews,
      layoutPreviews,
    };
  }
}
