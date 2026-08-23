import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  WhatsAppCloudProvider,
  WhatsAppEvolutionProvider,
  getEncryptionKey,
  decryptSecret,
} from '@lia/integrations';

@Injectable()
export class WhatsAppPublisher {
  private readonly logger = new Logger(WhatsAppPublisher.name);
  private get cloudProvider() {
    return new WhatsAppCloudProvider();
  }
  private get evolutionProvider() {
    return new WhatsAppEvolutionProvider();
  }

  constructor(private readonly prisma: PrismaService) {}

  async publish(
    offerId: string,
    publicationId: string,
    channelId: string,
    finalUrl: string,
    title: string,
    priceCents: number,
    discountBps: number | null,
  ): Promise<string | null> {
    // 1. Load Channel Integration and Configuration
    const channel = await this.prisma.channel.findUnique({
      where: { id: channelId },
      include: { tenant: { include: { channelIntegrations: true } } },
    });

    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    const whatsappIntegration = channel.tenant.channelIntegrations.find(
      (i) => i.provider === 'WHATSAPP' && i.status === 'CONNECTED',
    );

    if (!whatsappIntegration) {
      throw new Error(
        `WhatsApp is not configured or connected for tenant ${channel.tenantId}`,
      );
    }

    if (whatsappIntegration.transport === 'WEB_UNOFFICIAL') {
      if (
        !whatsappIntegration.externalInstanceName ||
        !whatsappIntegration.encryptedAccessToken
      ) {
        throw new Error(
          `Evolution API is missing credentials for tenant ${channel.tenantId}`,
        );
      }

      const masterKey = getEncryptionKey();
      const instanceToken = decryptSecret(
        whatsappIntegration.encryptedAccessToken,
        whatsappIntegration.tokenIv!,
        whatsappIntegration.tokenAuthTag!,
        masterKey,
      );

      // Copy Engine manual para o grupo
      const priceStr = `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}`;
      const discountStr = discountBps
        ? ` 🔥 ${(discountBps / 100).toFixed(0)}% OFF`
        : '';

      const copyText = `*${title}*\n\n💰 Por apenas: ${priceStr}${discountStr}\n\n🛒 Compre aqui: ${finalUrl}`;

      this.logger.log(
        `Publishing offer ${offerId} to WhatsApp Group ${channel.externalChatId} via Evolution`,
      );

      const messageId = await this.evolutionProvider.sendGroupMessage(
        whatsappIntegration.externalInstanceName,
        instanceToken,
        channel.externalChatId, // groupJid
        copyText,
      );

      return messageId;
    }

    // CLOUD OFFICIAL PATH
    // 2. Prepare payload
    const priceStr = `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}`;
    const discountStr = discountBps
      ? `${(discountBps / 100).toFixed(0)}%`
      : 'Sem desconto';

    const payload = {
      to: channel.externalChatId,
      type: 'template' as const,
      template: {
        name: 'lia_offer_template',
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: title },
              { type: 'text', text: priceStr },
              { type: 'text', text: discountStr },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: finalUrl }],
          },
        ],
      },
    };

    // 3. Send
    this.logger.log(
      `Publishing offer ${offerId} to WhatsApp ${channel.externalChatId} via Cloud API`,
    );

    const response = await this.cloudProvider.sendMessage(
      {
        wabaId: whatsappIntegration.wabaId!,
        phoneNumberId: whatsappIntegration.phoneNumberId!,
        encryptedAccessToken: whatsappIntegration.encryptedAccessToken!,
        tokenIv: whatsappIntegration.tokenIv!,
        tokenAuthTag: whatsappIntegration.tokenAuthTag!,
      },
      payload,
    );

    if (response && response.messages && response.messages.length > 0) {
      const messageId = response.messages[0].id;
      return messageId;
    }

    throw new Error('No message ID returned from WhatsApp Provider');
  }
}
