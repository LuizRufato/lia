import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface SendTelegramMessageOptions {
  chatId: string;
  caption: string;
  imageUrl?: string | null;
  link: string;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly botToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
  }

  async sendOfferMessage(options: SendTelegramMessageOptions): Promise<string> {
    if (!this.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    }

    const { chatId, caption, imageUrl, link } = options;

    // Inline button via reply_markup
    const replyMarkup = {
      inline_keyboard: [[{ text: '🛒 VER OFERTA', url: link }]],
    };

    const urlBase = `https://api.telegram.org/bot${this.botToken}`;

    try {
      if (imageUrl) {
        try {
          const response = await firstValueFrom(
            this.httpService.post(`${urlBase}/sendPhoto`, {
              chat_id: chatId,
              photo: imageUrl,
              caption,
              parse_mode: 'MarkdownV2',
              reply_markup: replyMarkup,
            }),
          );
          return response.data.result.message_id.toString();
        } catch (photoError: any) {
          if (
            photoError.response?.data?.description?.includes(
              'failed to get HTTP URL content',
            ) ||
            photoError.response?.data?.description?.includes(
              'wrong file identifier',
            )
          ) {
            this.logger.warn(
              `Image upload failed, falling back to sendMessage`,
            );
            // Fallthrough to fallback
          } else {
            this.handleApiError(photoError);
          }
        }
      }

      // Fallback
      const response = await firstValueFrom(
        this.httpService.post(`${urlBase}/sendMessage`, {
          chat_id: chatId,
          text: caption,
          parse_mode: 'MarkdownV2',
          reply_markup: replyMarkup,
        }),
      );
      return response.data.result.message_id.toString();
    } catch (error: any) {
      this.handleApiError(error);
      throw error; // TS needs this though handleApiError throws
    }
  }

  private handleApiError(error: any) {
    if (error.response?.status === 429) {
      const retryAfter = error.response.data.parameters?.retry_after || 60;
      this.logger.error(
        `Telegram Rate Limit (429). Retry after ${retryAfter}s`,
      );
      throw new HttpException(
        {
          status: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Telegram Rate Limit',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.error(
      `Telegram API Error: ${error.response?.data?.description || error.message}`,
    );
    throw new Error(error.response?.data?.description || error.message);
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
  }
}
