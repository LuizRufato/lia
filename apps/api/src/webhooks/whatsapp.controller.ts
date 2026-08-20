import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Req,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { WhatsAppCloudProvider } from '@lia/integrations';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Public } from '../auth/public.decorator';

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private get provider() {
    return new WhatsAppCloudProvider();
  }

  constructor(
    @InjectQueue('whatsapp-webhooks') private readonly webhooksQueue: Queue,
  ) {}

  @Public()
  @Get()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    if (!mode || !verifyToken) {
      return res.sendStatus(HttpStatus.FORBIDDEN);
    }

    const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (!expectedToken) {
      console.error('WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured.');
      return res.sendStatus(HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const resultChallenge = this.provider.verifyWebhookChallenge(
      {
        'hub.mode': mode,
        'hub.verify_token': verifyToken,
        'hub.challenge': challenge,
      },
      expectedToken,
    );

    if (resultChallenge) {
      return res.status(HttpStatus.OK).send(resultChallenge);
    }

    return res.sendStatus(HttpStatus.FORBIDDEN);
  }

  @Public()
  @Post()
  async handleWebhook(@Body() body: any, @Res() res: Response) {
    // Retornar 200 rápido (fire-and-forget/durable enqueue) conforme exigência da Meta
    res.sendStatus(HttpStatus.OK);

    try {
      if (body.object === 'whatsapp_business_account') {
        for (const entry of body.entry || []) {
          for (const change of entry.changes || []) {
            if (change.value && change.value.messages) {
              // Notificações de mensagens recebidas
              await this.webhooksQueue.add('whatsapp-message', change.value, {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
              });
            }

            if (change.value && change.value.statuses) {
              // Notificações de status de entrega de mensagens enviadas pela LIA
              for (const status of change.value.statuses) {
                // O wamid identifica a mensagem enviada, mas um status específico para esse wamid pode chegar várias vezes.
                // O jobId ajuda a deduplicar se a Meta re-enviar exatamente o mesmo status.
                const jobId = `${status.id}-${status.status}`;
                await this.webhooksQueue.add(
                  'whatsapp-delivery-status',
                  status,
                  {
                    jobId,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 2000 },
                  },
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Erro ao enfileirar webhook do WhatsApp', err);
    }
  }
}
