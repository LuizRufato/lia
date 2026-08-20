import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  PublicationDeliveryStatus,
  ChannelProvider,
  PublicationStatus,
} from '@prisma/client';

@Processor('whatsapp-webhooks')
@Injectable()
export class WhatsAppWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsAppWebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'whatsapp-delivery-status') {
      await this.handleDeliveryStatus(job.data);
    } else if (job.name === 'whatsapp-message') {
      this.logger.log(
        `Received incoming message from WhatsApp: ${JSON.stringify(job.data)}`,
      );
      // Implementar lógica de recebimento de mensagens futuras
    }
  }

  private async handleDeliveryStatus(statusPayload: any) {
    const wamid = statusPayload.id;
    const statusStr = statusPayload.status;
    const timestampStr = statusPayload.timestamp;

    let deliveryStatus: PublicationDeliveryStatus;
    switch (statusStr) {
      case 'sent':
        deliveryStatus = 'SENT';
        break;
      case 'delivered':
        deliveryStatus = 'DELIVERED';
        break;
      case 'read':
        deliveryStatus = 'READ';
        break;
      case 'failed':
        deliveryStatus = 'FAILED';
        break;
      default:
        this.logger.warn(
          `Unknown WhatsApp status: ${statusStr} for wamid: ${wamid}`,
        );
        return;
    }

    // Achar a publicação correspondente
    const publication = await this.prisma.publication.findFirst({
      where: { externalMessageId: wamid, channel: { provider: 'WHATSAPP' } },
      select: { id: true, status: true },
    });

    if (!publication) {
      this.logger.warn(`No publication found for WhatsApp wamid: ${wamid}`);
      return;
    }

    const occurredAt = timestampStr
      ? new Date(parseInt(timestampStr) * 1000)
      : null;
    let errorCode = null;
    let errorMessageSanitized = null;

    if (statusPayload.errors && statusPayload.errors.length > 0) {
      errorCode = statusPayload.errors[0].code?.toString();
      errorMessageSanitized = statusPayload.errors[0].title;
    }

    try {
      // Usar transação para manter histórico e atualizar a publicação, respeitando idempotência
      await this.prisma.$transaction(async (tx) => {
        const existingEvent = await tx.publicationDeliveryEvent.findUnique({
          where: {
            externalMessageId_status: {
              externalMessageId: wamid,
              status: deliveryStatus,
            },
          },
        });

        if (existingEvent) {
          // Evento já processado, skip
          return;
        }

        await tx.publicationDeliveryEvent.create({
          data: {
            publicationId: publication.id,
            provider: ChannelProvider.WHATSAPP,
            externalMessageId: wamid,
            status: deliveryStatus,
            occurredAt,
            errorCode,
            errorMessageSanitized,
          },
        });

        // Atualizar o status principal da Publication apenas se fizer sentido (ex: FAILED ou PUBLISHED -> DELIVERED)
        if (deliveryStatus === 'FAILED' && publication.status !== 'FAILED') {
          await tx.publication.update({
            where: { id: publication.id },
            data: {
              status: PublicationStatus.FAILED,
              errorReason:
                errorMessageSanitized || 'Failed to deliver WhatsApp message',
            },
          });
        }
      });
    } catch (error) {
      this.logger.error(
        `Error processing webhook status for wamid ${wamid}:`,
        error,
      );
      throw error;
    }
  }
}
