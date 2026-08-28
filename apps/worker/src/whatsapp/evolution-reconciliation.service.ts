import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma.service';
import {
  decryptSecret,
  getEncryptionKey,
  WhatsAppEvolutionProvider,
} from '@lia/integrations';
import { AdminAlertEventsService } from '../admin-alerts/admin-alert-events.service';

/** Periodically reconciles remote Evolution state with the local integration row. */
@Injectable()
export class EvolutionReconciliationService {
  private readonly logger = new Logger(EvolutionReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly adminAlertEvents?: AdminAlertEventsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async reconcile(): Promise<void> {
    const integrations = await this.prisma.channelIntegration.findMany({
      where: {
        provider: 'WHATSAPP',
        transport: 'WEB_UNOFFICIAL',
        externalInstanceName: { not: null },
        encryptedAccessToken: { not: null },
        tokenIv: { not: null },
        tokenAuthTag: { not: null },
      },
    });
    if (!integrations.length) return;

    let provider: WhatsAppEvolutionProvider;
    try {
      provider = new WhatsAppEvolutionProvider();
    } catch (error: any) {
      this.logger.warn(
        `Evolution reconciliation unavailable: ${error.message}`,
      );
      return;
    }

    const key = getEncryptionKey();
    for (const integration of integrations) {
      try {
        const token = decryptSecret(
          integration.encryptedAccessToken!,
          integration.tokenIv!,
          integration.tokenAuthTag!,
          key,
        );
        const state = await provider.getConnectionState(
          integration.externalInstanceName!,
          token,
        );
        const nextStatus =
          state === 'open'
            ? 'CONNECTED'
            : state === 'connecting'
              ? 'CONNECTING'
              : state === 'UNAUTHORIZED' ||
                  state === 'DISCONNECTED' ||
                  state === 'close'
                ? 'NEEDS_REAUTH'
                : 'ERROR';
        await this.prisma.channelIntegration.update({
          where: { id: integration.id },
          data: {
            status: nextStatus,
            lastHealthCheckAt: new Date(),
            lastErrorCode:
              nextStatus === 'CONNECTED'
                ? null
                : `EVOLUTION_${state.toUpperCase()}`,
            ...(nextStatus === 'CONNECTED'
              ? { connectedAt: integration.connectedAt || new Date() }
              : {}),
          },
        });
        if (nextStatus === 'NEEDS_REAUTH' || nextStatus === 'ERROR') {
          await this.reportOffline(
            integration,
            nextStatus,
            integration.lastErrorCode,
          );
        }
      } catch (error: any) {
        const wasConnected = integration.status === 'CONNECTED';
        await this.prisma.channelIntegration.update({
          where: { id: integration.id },
          data: {
            status: wasConnected ? 'CONNECTED' : 'ERROR',
            lastHealthCheckAt: new Date(),
            lastErrorCode: 'EVOLUTION_HEALTH_CHECK_FAILED',
          },
        });
        if (!wasConnected) {
          await this.reportOffline(
            integration,
            'ERROR',
            'EVOLUTION_HEALTH_CHECK_FAILED',
          );
        }
        this.logger.warn(
          `Evolution health check failed for integration ${integration.id}: ${error.message}`,
        );
      }
    }
  }

  private async reportOffline(
    integration: any,
    state: string,
    error?: string | null,
  ) {
    if (!this.adminAlertEvents) return;
    try {
      await this.adminAlertEvents.createEvolutionOfflineAlert({
        tenantId: integration.tenantId,
        integrationId: integration.id,
        integrationName: integration.businessDisplayName,
        state,
        error,
      });
    } catch (alertError: any) {
      this.logger.error(
        `ADMIN_ALERT_EVOLUTION_OFFLINE_FAILED: ${alertError?.message || alertError}`,
      );
    }
  }
}
