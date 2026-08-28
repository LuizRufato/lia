import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdminAlertEventsService } from './admin-alert-events.service';
import {
  DAILY_SUMMARY_HOUR,
  DAILY_SUMMARY_MINUTE,
  DAILY_SUMMARY_TIMEZONE,
  getZonedParts,
} from './daily-summary-time';

@Injectable()
export class AdminAlertsScheduler {
  private readonly logger = new Logger(AdminAlertsScheduler.name);

  constructor(private readonly adminAlertEvents: AdminAlertEventsService) {}

  @Cron('0 * * * * *')
  async scheduleDailySummary() {
    const now = new Date();
    const parts = getZonedParts(now);
    if (
      parts.hour !== DAILY_SUMMARY_HOUR ||
      parts.minute !== DAILY_SUMMARY_MINUTE
    )
      return;
    this.logger.log(
      `DAILY_SUMMARY_SCHEDULED time=${DAILY_SUMMARY_HOUR}:${String(DAILY_SUMMARY_MINUTE).padStart(2, '0')} timezone=${DAILY_SUMMARY_TIMEZONE}`,
    );
    await this.adminAlertEvents.scheduleDailySummaries(now);
  }
}
