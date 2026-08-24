import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { MercadoLivreController } from './mercadolivre.controller';
import { MercadoLivreService } from './mercadolivre.service';
import { MercadoLivreSyncService } from './mercadolivre-sync.service';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import { WhatsAppWebhookController } from '../webhooks/whatsapp.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'shopee-api-queue',
    }),
    BullModule.registerQueue({
      name: 'shopee-conversions-queue',
    }),
    BullModule.registerQueue({
      name: 'whatsapp-webhooks',
    }),
    BullModule.registerQueue({
      name: 'offer-processing',
    }),
  ],
  controllers: [
    IntegrationsController,
    MercadoLivreController,
    WhatsAppWebhookController,
  ],
  providers: [
    IntegrationsService,
    MercadoLivreService,
    MercadoLivreSyncService,
    PrismaService,
    ConfigService,
  ],
})
export class IntegrationsModule {}
