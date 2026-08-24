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
} from '@lia/core';

const TYPES = ['ACHADINHO', 'OFERTA', 'PRECO_CAIU', 'MAIS_VENDIDO', 'GENERIC'];
const CTA_MODES = ['AUTO', 'CUSTOM'];

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

  private async ensureDefaults(tenantId: string) {
    const client = (this.prisma as any).publicationTemplate;
    const count = await client.count({ where: { tenantId } });
    if (count === 0) {
      await client.createMany({
        data: DEFAULT_PUBLICATION_TEMPLATES.map((template) => ({
          ...template,
          tenantId,
        })),
      });
    }
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
    const client = (this.prisma as any).publicationTemplate;
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
    const client = (this.prisma as any).publicationTemplate;
    const existing = await client.findFirst({ where: { id, tenantId } });
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
    const offer = await this.prisma.offer.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      include: {
        marketplace: true,
        priceHistories: { orderBy: { observedAt: 'desc' }, take: 20 },
      },
    });
    const context = offer
      ? {
          title: offer.title,
          priceCents: offer.price,
          currentOriginalPriceCents:
            offer.priceHistories[0]?.originalPriceCents ?? null,
          currentObservedAt:
            offer.priceHistories[0]?.observedAt ?? offer.updatedAt,
          previousPrices: offer.priceHistories.slice(1),
          discountBps: offer.priceHistories[0]?.discountBps ?? null,
          salesCount: offer.priceHistories[0]?.salesCount ?? null,
          rating: offer.priceHistories[0]?.rating ?? null,
          marketplace: offer.marketplace.name,
          finalLink: 'https://go.botlia.com.br/preview',
        }
      : {
          title: 'Produto de demonstração',
          priceCents: 9990,
          finalLink: 'https://go.botlia.com.br/preview',
          marketplace: 'Shopee',
        };
    return {
      isDemo: !offer,
      variables: PUBLICATION_TEMPLATE_VARIABLES,
      offer: offer ? { title: offer.title, priceCents: offer.price } : null,
      previews: templates.map((template: any) => ({
        id: template.id,
        name: template.name,
        type: template.type,
        rendered: CopyEngine.render(template, context).text,
      })),
    };
  }
}
