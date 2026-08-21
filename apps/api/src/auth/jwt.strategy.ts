import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: any) => {
          const data = request?.cookies?.Authentication;
          if (!data) {
            return null;
          }
          return data;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: any) {
    const adminUserId = payload.sub;
    const tenantId = payload.tenantId;

    if (typeof adminUserId !== 'string' || typeof tenantId !== 'string') {
      throw new UnauthorizedException('Sessão sem contexto de tenant válido');
    }

    // Reuse the tenant selected at login instead of selecting an arbitrary
    // membership on every request.
    const membership = await this.prisma.tenantMembership.findFirst({
      where: { adminUserId, tenantId },
      include: { tenant: true },
    });

    if (!membership) {
      throw new UnauthorizedException('User does not belong to any tenant');
    }

    return {
      id: adminUserId,
      email: payload.email,
      tenantId: membership.tenantId,
      role: membership.role,
    };
  }
}
