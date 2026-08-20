import { Test, TestingModule } from '@nestjs/testing';
import { WhatsAppPublisher } from './whatsapp.publisher';
import { PrismaService } from '../prisma.service';
import { WhatsAppCloudProvider } from '@lia/integrations';

jest.mock('@lia/integrations', () => {
  return {
    WhatsAppCloudProvider: jest.fn().mockImplementation(() => {
      return {
        sendMessage: jest
          .fn()
          .mockResolvedValue({ messages: [{ id: 'wamid.test' }] }),
      };
    }),
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
});
