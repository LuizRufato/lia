import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  WhatsAppCloudProvider,
  WhatsAppEvolutionProvider,
  getEncryptionKey,
  decryptSecret,
} from '@lia/integrations';
import {
  CopyEngine,
  DEFAULT_PUBLICATION_TEMPLATES,
  PublicationCopyContext,
  firstHttpsImageUrl,
} from '@lia/core';

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
    copyContext?: Omit<
      PublicationCopyContext,
      'title' | 'priceCents' | 'finalLink'
    >,
    imageUrl?: string | null,
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

      let templates = DEFAULT_PUBLICATION_TEMPLATES;
      const templateClient = (this.prisma as any).publicationTemplate;
      if (templateClient?.findMany) {
        const persisted = await templateClient.findMany({
          where: { tenantId: channel.tenantId, enabled: true },
          orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
        });
        if (persisted.length) templates = persisted;
      }
      const rendered = CopyEngine.renderPublication(templates, {
        title,
        priceCents,
        discountBps,
        finalLink: finalUrl,
        locale: 'pt-BR',
        currency: 'BRL',
        ...copyContext,
      });

      this.logger.log(
        `Publishing offer ${offerId} to WhatsApp Group ${channel.externalChatId} via Evolution`,
      );

      const safeImageUrl = firstHttpsImageUrl(imageUrl ? [imageUrl] : []);
      let messageId: string | null;
      if (safeImageUrl) {
        this.logger.log(`PUBLICATION_IMAGE_SELECTED offer=${offerId}`);
        this.logger.log(`PUBLICATION_MEDIA_SEND_STARTED offer=${offerId}`);
        try {
          messageId = await this.evolutionProvider.sendGroupMediaMessage(
            whatsappIntegration.externalInstanceName,
            instanceToken,
            channel.externalChatId,
            { mediaUrl: safeImageUrl, caption: rendered.text },
          );
        } catch (error) {
          this.logger.error(`PUBLICATION_MEDIA_SEND_FAILED offer=${offerId}`);
          throw error;
        }
        this.logger.log(`PUBLICATION_MEDIA_SEND_SUCCESS offer=${offerId}`);
      } else {
        this.logger.warn(
          `${imageUrl ? 'PUBLICATION_IMAGE_INVALID' : 'PUBLICATION_IMAGE_MISSING'} offer=${offerId}`,
        );
        messageId = await this.evolutionProvider.sendGroupMessage(
          whatsappIntegration.externalInstanceName,
          instanceToken,
          channel.externalChatId,
          rendered.text,
        );
      }

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
