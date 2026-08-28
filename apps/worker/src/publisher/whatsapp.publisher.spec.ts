import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppPublisher } from './whatsapp.publisher';
import { PrismaService } from '../prisma.service';
import {
  WhatsAppCloudProvider,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';

jest.mock('@lia/integrations', () => {
  return {
    WhatsAppCloudProvider: jest.fn().mockImplementation(() => {
      return {
        sendMessage: jest
          .fn()
          .mockResolvedValue({ messages: [{ id: 'wamid.test' }] }),
      };
    }),
    WhatsAppEvolutionProvider: jest.fn().mockImplementation(() => ({
      sendGroupMessage: jest.fn().mockResolvedValue('evolution-message'),
      sendGroupMediaMessage: jest
        .fn()
        .mockResolvedValue('evolution-media-message'),
    })),
    getEncryptionKey: jest.fn().mockReturnValue('key'),
    decryptSecret: jest.fn().mockReturnValue('instance-token'),
  };
});

describe('WhatsAppPublisher', () => {
  let publisher: WhatsAppPublisher;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsAppPublisher,
        {
          provide: PrismaService,
          useValue: {
            channel: {
              findUnique: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    publisher = module.get<WhatsAppPublisher>(WhatsAppPublisher);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should throw error if channel not found', async () => {
    (prismaService.channel.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      publisher.publish('offer1', 'pub1', 'chan1', 'url', 'title', 100, null),
    ).rejects.toThrow('Channel chan1 not found');
  });

  it('should publish successfully when correctly configured', async () => {
    const mockChannel = {
      id: 'chan1',
      externalChatId: '5511999999999',
      tenantId: 'tenant1',
      tenant: {
        channelIntegrations: [
          {
            provider: 'WHATSAPP',
            status: 'CONNECTED',
            wabaId: 'waba123',
            phoneNumberId: 'phone123',
            encryptedAccessToken: 'token',
          },
        ],
      },
    };
    (prismaService.channel.findUnique as jest.Mock).mockResolvedValue(
      mockChannel,
    );

    const messageId = await publisher.publish(
      'offer1',
      'pub1',
      'chan1',
      'url',
      'title',
      1000,
      null,
    );
    expect(messageId).toBe('wamid.test');
  });

  it('renders the configured safe copy and preserves Evolution payload shape', async () => {
    const mockChannel = {
      id: 'chan1',
      externalChatId: 'group@g.us',
      tenantId: 'tenant1',
      tenant: {
        channelIntegrations: [
          {
            provider: 'WHATSAPP',
            status: 'CONNECTED',
            transport: 'WEB_UNOFFICIAL',
            externalInstanceName: 'lia',
            encryptedAccessToken: 'encrypted',
            tokenIv: 'iv',
            tokenAuthTag: 'tag',
          },
        ],
      },
    };
    (prismaService.channel.findUnique as jest.Mock).mockResolvedValue(
      mockChannel,
    );
    const messageId = await publisher.publish(
      'offer1',
      'pub1',
      'chan1',
      'https://go.botlia.com.br/slug',
      'Oferta real',
      1250,
      null,
    );
    expect(messageId).toBe('evolution-message');
    const results = (WhatsAppEvolutionProvider as jest.Mock).mock.results;
    const provider = results[results.length - 1]?.value;
    expect(provider.sendGroupMessage).toHaveBeenCalledWith(
      'lia',
      'instance-token',
      'group@g.us',
      expect.stringContaining('Oferta real'),
    );
    expect(provider.sendGroupMessage.mock.calls[0][3]).toContain(
      'https://go.botlia.com.br/slug',
    );
    expect(provider.sendGroupMessage.mock.calls[0][3]).not.toContain(
      'undefined',
    );
  });

  it('uses the latest saved template and sends text for the Smart Preview', async () => {
    const mockChannel = {
      id: 'chan1',
      externalChatId: 'group@g.us',
      tenantId: 'tenant1',
      tenant: {
        channelIntegrations: [
          {
            provider: 'WHATSAPP',
            status: 'CONNECTED',
            transport: 'WEB_UNOFFICIAL',
            externalInstanceName: 'lia',
            encryptedAccessToken: 'encrypted',
            tokenIv: 'iv',
            tokenAuthTag: 'tag',
          },
        ],
      },
    };
    (prismaService.channel.findUnique as jest.Mock).mockResolvedValue(
      mockChannel,
    );
    (prismaService as any).publicationTemplate = {
      findMany: jest.fn().mockResolvedValue([
        {
          name: 'Editado agora',
          type: 'ACHADINHO',
          enabled: true,
          isDefault: true,
          priority: 100,
          ctaMode: 'CUSTOM',
          customCta: 'Abrir agora',
          body: 'EDITADO {titulo} {link}',
        },
      ]),
    };

    await publisher.publish(
      'offer1',
      'pub1',
      'chan1',
      'https://go.botlia.com.br/slug',
      'Oferta real',
      1250,
      null,
      undefined,
    );

    const provider = (WhatsAppEvolutionProvider as jest.Mock).mock.results.at(
      -1,
    )?.value;
    expect(provider.sendGroupMessage).toHaveBeenCalledWith(
      'lia',
      'instance-token',
      'group@g.us',
      expect.stringContaining('EDITADO Oferta real'),
    );
    expect(provider.sendGroupMessage.mock.calls[0][3]).toContain(
      'https://go.botlia.com.br/slug',
    );
    expect(provider.sendGroupMediaMessage).not.toHaveBeenCalled();
  });

  it('loads an edited persisted template on the next send without recreating the publisher', async () => {
    const mockChannel = {
      id: 'chan1',
      externalChatId: 'group@g.us',
      tenantId: 'tenant1',
      tenant: {
        channelIntegrations: [
          {
            provider: 'WHATSAPP',
            status: 'CONNECTED',
            transport: 'WEB_UNOFFICIAL',
            externalInstanceName: 'lia',
            encryptedAccessToken: 'encrypted',
            tokenIv: 'iv',
            tokenAuthTag: 'tag',
          },
        ],
      },
    };
    (prismaService.channel.findUnique as jest.Mock).mockResolvedValue(
      mockChannel,
    );
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        {
          name: 'Versão A',
          type: 'ACHADINHO',
          enabled: true,
          isDefault: true,
          priority: 100,
          ctaMode: 'AUTO',
          customCta: null,
          body: 'A {titulo} {link}',
        },
      ])
      .mockResolvedValueOnce([
        {
          name: 'Versão B',
          type: 'ACHADINHO',
          enabled: true,
          isDefault: true,
          priority: 100,
          ctaMode: 'AUTO',
          customCta: null,
          body: 'B {titulo} {link}',
        },
      ]);
    (prismaService as any).publicationTemplate = { findMany };

    await publisher.publish(
      'offer1',
      'pub1',
      'chan1',
      'https://go.botlia.com.br/a',
      'Oferta real',
      1250,
      null,
    );
    await publisher.publish(
      'offer1',
      'pub2',
      'chan1',
      'https://go.botlia.com.br/b',
      'Oferta real',
      1250,
      null,
    );

    const providers = (WhatsAppEvolutionProvider as jest.Mock).mock.results;
    expect(providers.at(-2)?.value.sendGroupMessage.mock.calls[0][3]).toContain(
      'A Oferta real',
    );
    expect(providers.at(-1)?.value.sendGroupMessage.mock.calls[0][3]).toContain(
      'B Oferta real',
    );
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
