import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConfigService } from '@nestjs/config';
import {
  decryptSecret,
  encryptSecret,
  getEncryptionKey,
} from '@lia/integrations';
import { randomBytes, createHash } from 'crypto';
import Redis from 'ioredis';
import { getRedisConfig } from '@lia/core';

@Injectable()
export class MercadoLivreService {
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.redis = new Redis(getRedisConfig().url);
  }

  async getIntegration(tenantId: string) {
    const clientId = process.env.MELI_CLIENT_ID;
    const clientSecret = process.env.MELI_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return { status: 'PENDING_GLOBAL_CONFIG' };
    }

    const integration = await this.prisma.marketplaceIntegration.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' },
      },
    });

    if (!integration) {
      return { status: 'NOT_CONNECTED' };
    }

    return {
      status: integration.status,
      meliUserId: integration.publicIdentifier,
      lastSyncAt: integration.lastSyncAt,
      lastSyncFoundCount: integration.lastSyncFoundCount,
      lastSyncCreatedCount: integration.lastSyncCreatedCount,
      lastSyncUpdatedCount: integration.lastSyncUpdatedCount,
      lastSyncIgnoredCount: integration.lastSyncIgnoredCount,
      lastSyncProcessedCount: integration.lastSyncProcessedCount,
      lastDiscoveryAt: integration.lastDiscoveryAt,
      lastDiscoveryCategoryCount: integration.lastDiscoveryCategoryCount,
      lastDiscoveryFoundCount: integration.lastDiscoveryFoundCount,
      lastDiscoveryCreatedCount: integration.lastDiscoveryCreatedCount,
      lastDiscoveryIgnoredCount: integration.lastDiscoveryIgnoredCount,
      lastDiscoveryError: integration.lastDiscoveryError,
      lastError: integration.lastError,
      expiresAt: integration.expiresAt,
    };
  }

  async generateAuthUrl(tenantId: string) {
    const clientId = process.env.MELI_CLIENT_ID;
    const redirectUri = process.env.MELI_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new BadRequestException('MELI Global Config missing.');
    }

    // PKCE & State
    const state = randomBytes(32).toString('hex');
    const codeVerifier = randomBytes(32).toString('hex');

    // Create codeChallenge using base64url encoding (no padding)
    const codeChallenge = createHash('sha256')
      .update(codeVerifier, 'ascii')
      .digest('base64url');

    // Redis short-lived state (10 mins)
    const stateKey = `meli:oauth:state:${createHash('sha256').update(state).digest('hex')}`;

    await this.redis.set(
      stateKey,
      JSON.stringify({
        tenantId,
        codeVerifier,
        createdAt: Date.now(),
      }),
      'EX',
      600,
    ); // 10 minutes TTL

    // Meli auth URL using URL to avoid encoding bugs
    const authUrlObj = new URL(
      'https://auth.mercadolivre.com.br/authorization',
    );
    authUrlObj.searchParams.append('response_type', 'code');
    authUrlObj.searchParams.append('client_id', clientId);
    authUrlObj.searchParams.append('redirect_uri', redirectUri);
    authUrlObj.searchParams.append('state', state);
    authUrlObj.searchParams.append('code_challenge', codeChallenge);
    authUrlObj.searchParams.append('code_challenge_method', 'S256');

    return { url: authUrlObj.toString() };
  }

  async handleCallback(state: string, code: string) {
    const stateHash = createHash('sha256').update(state).digest('hex');
    const stateKey = `meli:oauth:state:${stateHash}`;

    // 1. Atomic GETDEL to ensure single-use
    // (ioredis supports getdel if Redis >= 6.2)
    let stateData: string | null = null;
    try {
      stateData = await this.redis.getdel(stateKey);
    } catch (e) {
      // Fallback if Redis version < 6.2 (using Lua for atomicity)
      const luaScript = `
        local val = redis.call('GET', KEYS[1])
        if val then
          redis.call('DEL', KEYS[1])
        end
        return val
      `;
      stateData = (await this.redis.eval(luaScript, 1, stateKey)) as
        string | null;
    }

    if (!stateData) {
      throw new BadRequestException('Invalid or expired state.');
    }

    const { tenantId, codeVerifier } = JSON.parse(stateData);

    const clientId = process.env.MELI_CLIENT_ID;
    const clientSecret = process.env.MELI_CLIENT_SECRET;
    const redirectUri = process.env.MELI_REDIRECT_URI;

    // Exchange code for token
    const tokenResponse = await fetch(
      'https://api.mercadolibre.com/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId!,
          client_secret: clientSecret!,
          code,
          redirect_uri: redirectUri!,
          code_verifier: codeVerifier,
        }),
      },
    );

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      throw new BadRequestException(`Failed to exchange code: ${errorData}`);
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, user_id } = tokenData;

    const masterKey = this.configService.get<string>(
      'INTEGRATION_ENCRYPTION_KEY',
    );
    if (!masterKey) throw new BadRequestException('Master key missing');

    const encryptedAccess = encryptSecret(access_token, masterKey);
    const encryptedRefresh = encryptSecret(refresh_token, masterKey);

    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await this.prisma.marketplaceIntegration.upsert({
      where: {
        tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' },
      },
      update: {
        publicIdentifier: String(user_id),
        encryptedSecret: encryptedAccess.encryptedSecret,
        iv: encryptedAccess.iv,
        authTag: encryptedAccess.authTag,
        encryptedRefreshToken: encryptedRefresh.encryptedSecret,
        refreshIv: encryptedRefresh.iv,
        refreshAuthTag: encryptedRefresh.authTag,
        expiresAt,
        status: 'CONNECTED',
        lastError: null,
      },
      create: {
        tenantId,
        provider: 'MERCADO_LIVRE',
        publicIdentifier: String(user_id),
        encryptedSecret: encryptedAccess.encryptedSecret,
        iv: encryptedAccess.iv,
        authTag: encryptedAccess.authTag,
        encryptedRefreshToken: encryptedRefresh.encryptedSecret,
        refreshIv: encryptedRefresh.iv,
        refreshAuthTag: encryptedRefresh.authTag,
        expiresAt,
        status: 'CONNECTED',
      },
    });

    return { success: true };
  }

  async disconnect(tenantId: string) {
    await this.prisma.marketplaceIntegration.delete({
      where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
    });
    return { success: true };
  }

  async refreshAccessToken(tenantId: string) {
    const lockKey = `meli:refresh:lock:${tenantId}`;
    const ownerToken = randomBytes(16).toString('hex');

    // Attempt to acquire lock for 30 seconds with ownerToken
    const lockAcquired = await this.redis.set(
      lockKey,
      ownerToken,
      'EX',
      30,
      'NX',
    );

    if (!lockAcquired) {
      // Another worker is currently refreshing.
      throw new Error('Concurrent refresh in progress, try again later.');
    }

    try {
      const integration = await this.prisma.marketplaceIntegration.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
      });

      if (
        !integration ||
        !integration.encryptedRefreshToken ||
        !integration.refreshIv ||
        !integration.refreshAuthTag
      ) {
        throw new BadRequestException('No refresh token available');
      }

      const masterKey = this.configService.get<string>(
        'INTEGRATION_ENCRYPTION_KEY',
      );
      if (!masterKey) throw new BadRequestException('Master key missing');

      // 1. Decrypt the OLD refresh token
      const { decryptSecret } = require('@lia/integrations');
      let oldRefreshToken: string;
      try {
        oldRefreshToken = decryptSecret(
          integration.encryptedRefreshToken,
          integration.refreshIv,
          integration.refreshAuthTag,
          masterKey,
        );
      } catch (e) {
        throw new BadRequestException('Failed to decrypt refresh token');
      }

      const clientId = process.env.MELI_CLIENT_ID;
      const clientSecret = process.env.MELI_CLIENT_SECRET;

      // 2. Refresh call
      const tokenResponse = await fetch(
        'https://api.mercadolibre.com/oauth/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId!,
            client_secret: clientSecret!,
            refresh_token: oldRefreshToken,
          }),
        },
      );

      const tokenData = await tokenResponse.json().catch(() => null);

      if (!tokenResponse.ok) {
        // If invalid_grant, token is revoked or expired
        // Only update if it specifically is invalid_grant
        if (tokenData?.error === 'invalid_grant') {
          await this.prisma.marketplaceIntegration.update({
            where: { id: integration.id },
            data: { status: 'NEEDS_REAUTH', lastError: 'invalid_grant' },
          });
        }
        throw new BadRequestException('Refresh token failed');
      }

      if (!tokenData)
        throw new BadRequestException('Refresh token failed: No response body');

      // 3. Encrypt NEW tokens
      const encryptedAccess = encryptSecret(tokenData.access_token, masterKey);
      const encryptedRefresh = encryptSecret(
        tokenData.refresh_token,
        masterKey,
      );
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

      // 4. Update Database
      await this.prisma.marketplaceIntegration.update({
        where: { id: integration.id },
        data: {
          encryptedSecret: encryptedAccess.encryptedSecret,
          iv: encryptedAccess.iv,
          authTag: encryptedAccess.authTag,
          encryptedRefreshToken: encryptedRefresh.encryptedSecret,
          refreshIv: encryptedRefresh.iv,
          refreshAuthTag: encryptedRefresh.authTag,
          expiresAt,
          status: 'CONNECTED',
          lastError: null,
        },
      });

      return { success: true };
    } finally {
      // 5. Release lock using atomic compare-and-delete
      const luaScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(luaScript, 1, lockKey, ownerToken);
    }
  }

  async getAccessTokenForApi(tenantId: string): Promise<string> {
    let integration = await this.prisma.marketplaceIntegration.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
    });

    if (
      !integration ||
      integration.status !== 'CONNECTED' ||
      !integration.encryptedSecret ||
      !integration.iv ||
      !integration.authTag
    ) {
      throw new BadRequestException('Mercado Livre não está conectado.');
    }

    const refreshWindowMs = 60_000;
    if (
      !integration.expiresAt ||
      integration.expiresAt.getTime() <= Date.now() + refreshWindowMs
    ) {
      await this.refreshAccessToken(tenantId);
      integration = await this.prisma.marketplaceIntegration.findUnique({
        where: { tenantId_provider: { tenantId, provider: 'MERCADO_LIVRE' } },
      });
    }

    if (
      !integration?.encryptedSecret ||
      !integration.iv ||
      !integration.authTag
    ) {
      throw new BadRequestException('Token do Mercado Livre indisponível.');
    }

    try {
      return decryptSecret(
        integration.encryptedSecret,
        integration.iv,
        integration.authTag,
        getEncryptionKey(),
      );
    } catch {
      throw new BadRequestException(
        'Não foi possível descriptografar o token do Mercado Livre.',
      );
    }
  }
}
