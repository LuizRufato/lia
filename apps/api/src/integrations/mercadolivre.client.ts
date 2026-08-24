export interface MercadoLivreItemSearchResponse {
  results?: string[];
  paging?: { total?: number; limit?: number; offset?: number };
}

export interface MercadoLivreBatchItem {
  code: number;
  body?: Record<string, unknown>;
}

export class MercadoLivreApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'MercadoLivreApiError';
  }
}

export class MercadoLivreClient {
  private readonly baseUrl = 'https://api.mercadolibre.com';
  private readonly timeoutMs = 10_000;
  private readonly maxAttempts = 3;

  async searchActiveItemIds(
    userId: string,
    accessToken: string,
    limit = 50,
  ): Promise<MercadoLivreItemSearchResponse> {
    const params = new URLSearchParams({
      status: 'active',
      limit: String(Math.min(Math.max(limit, 1), 50)),
    });
    return this.request<MercadoLivreItemSearchResponse>(
      `/users/${encodeURIComponent(userId)}/items/search?${params.toString()}`,
      accessToken,
    );
  }

  async getItems(
    ids: string[],
    accessToken: string,
  ): Promise<MercadoLivreBatchItem[]> {
    if (!ids.length) return [];
    const params = new URLSearchParams({ ids: ids.join(',') });
    return this.request<MercadoLivreBatchItem[]>(
      `/items?${params.toString()}`,
      accessToken,
    );
  }

  private async request<T>(path: string, accessToken: string): Promise<T> {
    let lastError: MercadoLivreApiError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          signal: controller.signal,
        });

        if (response.ok) return (await response.json()) as T;

        const retryAfter = Number(response.headers.get('retry-after'));
        const error = new MercadoLivreApiError(
          response.status === 401
            ? 'Mercado Livre access token rejected.'
            : `Mercado Livre API returned HTTP ${response.status}.`,
          response.status,
          Number.isFinite(retryAfter) ? retryAfter : undefined,
        );

        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof MercadoLivreApiError) {
          if (error.status === 401) throw error;
          lastError = error;
        } else {
          lastError = new MercadoLivreApiError(
            'Mercado Livre API request timed out or failed.',
            0,
          );
        }
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < this.maxAttempts) {
        const delay = lastError?.retryAfterSeconds
          ? Math.min(lastError.retryAfterSeconds * 1000, 10_000)
          : 500 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new MercadoLivreApiError('Mercado Livre request failed.', 0);
  }
}
