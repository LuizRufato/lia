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
      offer: { findFirst: jest.fn() },
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
});
