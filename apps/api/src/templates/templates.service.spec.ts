import { DEFAULT_PUBLICATION_TEMPLATES } from '@lia/core';
import { TemplatesService } from './templates.service';

describe('TemplatesService', () => {
  const tenantId = 'tenant-1';

  function createService(initialRows: any[] = []) {
    let rows = [...initialRows];
    const client = {
      findMany: jest.fn(async () => [...rows]),
      count: jest.fn(async () => rows.length),
      createMany: jest.fn(async ({ data }: any) => {
        rows = rows.concat(
          data.map((item: any, index: number) => ({
            ...item,
            id: `created-${index}`,
            createdAt: new Date(),
          })),
        );
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const ids = new Set(where.id.in);
        const before = rows.length;
        rows = rows.filter((row) => !ids.has(row.id));
        return { count: before - rows.length };
      }),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(async ({ data }: any) => data),
      update: jest.fn(async ({ data }: any) => data),
    };
    const prisma: any = {
      publicationTemplate: client,
      offer: { findFirst: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (callback: any) =>
        callback({
          publicationTemplate: client,
        }),
      ),
    };
    return { service: new TemplatesService(prisma), client };
  }

  it('deduplicates default-equivalent rows and preserves custom templates', async () => {
    const defaultTemplate = DEFAULT_PUBLICATION_TEMPLATES[0];
    const rows = [
      {
        ...defaultTemplate,
        id: 'default-old',
        tenantId,
        enabled: true,
        isDefault: true,
        createdAt: new Date('2026-01-01'),
      },
      {
        ...defaultTemplate,
        id: 'default-duplicate',
        tenantId,
        enabled: false,
        isDefault: false,
        createdAt: new Date('2026-02-01'),
      },
      {
        id: 'custom',
        tenantId,
        name: 'Meu template',
        type: 'GENERIC',
        body: '{titulo} - customizado',
        enabled: true,
        isDefault: false,
        createdAt: new Date('2026-01-02'),
      },
    ];
    const { service, client } = createService(rows);

    const result = await service.list(tenantId);

    expect(result.map((row: any) => row.id)).toEqual(['default-old', 'custom']);
    expect(client.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, id: { in: ['default-duplicate'] } },
    });
  });

  it('seeds defaults with duplicate-safe insertion for an empty tenant', async () => {
    const { service, client } = createService();

    await service.list(tenantId);

    expect(client.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ tenantId, isDefault: true }),
      ]),
      skipDuplicates: true,
    });
  });

  it('unsets other defaults when creating a new default', async () => {
    const { service, client } = createService();
    client.create = jest.fn(async ({ data }: any) => data);

    await service.create(tenantId, {
      name: 'Meu padrão',
      type: 'GENERIC',
      body: '{titulo}',
      isDefault: true,
    });

    expect(client.updateMany).toHaveBeenCalledWith({
      where: { tenantId },
      data: { isDefault: false },
    });
    expect(client.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId, isDefault: true }),
    });
  });

  it('unsets other defaults when updating a template to the default', async () => {
    const { service, client } = createService();
    const existing = {
      id: 'template-1',
      tenantId,
      name: 'Meu template',
      type: 'GENERIC',
      body: '{titulo}',
      ctaMode: 'AUTO',
      customCta: null,
      enabled: true,
      isDefault: false,
      priority: 0,
    };
    client.findFirst.mockResolvedValue(existing);

    await service.update(tenantId, existing.id, { isDefault: true });

    expect(client.updateMany).toHaveBeenCalledWith({
      where: { tenantId, id: { not: existing.id } },
      data: { isDefault: false },
    });
    expect(client.update).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: expect.objectContaining({ isDefault: true }),
    });
  });

  it('uses representative real offers for type-specific previews', async () => {
    const templates = DEFAULT_PUBLICATION_TEMPLATES.map((template, index) => ({
      ...template,
      id: `template-${index}`,
      tenantId,
      createdAt: new Date(),
    }));
    const { service } = createService(templates);
    const prisma = (service as any).prisma;
    prisma.offer.findMany.mockResolvedValue([
      {
        title: 'Oferta normal',
        price: 15000,
        updatedAt: new Date(),
        marketplace: { name: 'Shopee', type: 'SHOPEE' },
        priceHistories: [
          {
            priceCents: 15000,
            originalPriceCents: null,
            observedAt: new Date(),
            discountBps: null,
            salesCount: 12,
            rating: 4.2,
          },
          {
            priceCents: 20000,
            observedAt: new Date(Date.now() - 86400000),
            discountBps: null,
            salesCount: 10,
            rating: 4.1,
          },
        ],
      },
      {
        title: 'Mais vendido',
        price: 7990,
        updatedAt: new Date(Date.now() - 1000),
        marketplace: { name: 'Shopee', type: 'SHOPEE' },
        priceHistories: [
          {
            priceCents: 7990,
            originalPriceCents: null,
            observedAt: new Date(),
            discountBps: 2000,
            salesCount: 250,
            rating: 4.8,
          },
        ],
      },
    ]);

    const result = await service.preview(tenantId);
    const priceDrop = result.realPreviews.find(
      (item: any) => item.type === 'PRECO_CAIU',
    );
    const bestSeller = result.realPreviews.find(
      (item: any) => item.type === 'MAIS_VENDIDO',
    );

    expect(priceDrop.available).toBe(true);
    expect(priceDrop.rendered.replace(/\u00a0/g, ' ')).toContain('R$ 200,00');
    expect(priceDrop.rendered).not.toContain('Antes observado');
    expect(bestSeller.rendered).toContain('250');
    expect(bestSeller.variablesAvailable.desconto).toBe(true);
    expect(result.layoutPreviews[0].rendered).toContain(
      'Smartphone Exemplo LIA',
    );
  });

  it('keeps real previews explicit when no suitable offer exists', async () => {
    const templates = DEFAULT_PUBLICATION_TEMPLATES.map((template, index) => ({
      ...template,
      id: `template-${index}`,
      tenantId,
      createdAt: new Date(),
    }));
    const { service } = createService(templates);
    const prisma = (service as any).prisma;
    prisma.offer.findMany.mockResolvedValue([]);

    const result = await service.preview(tenantId);

    expect(result.realPreviews.every((item: any) => !item.available)).toBe(
      true,
    );
    expect(result.realPreviews[0].message).toContain(
      'Não há uma oferta real recente',
    );
    expect(result.layoutPreviews[0].rendered.replace(/\u00a0/g, ' ')).toContain(
      'R$ 799,90',
    );
  });
});
