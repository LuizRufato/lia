import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async login(loginDto: LoginDto) {
    const normalizedEmail = loginDto.email.trim().toLowerCase();
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: { adminUserId: user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!membership) {
      throw new UnauthorizedException(
        'Usuário não pertence a nenhum tenant configurado.',
      );
    }

    const payload = {
      email: user.email,
      sub: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async getUserTenants(userId: string) {
    const memberships = await this.prisma.tenantMembership.findMany({
      where: { adminUserId: userId },
      include: { tenant: true },
    });

    return memberships.map((m) => ({
      id: m.tenant.id,
      name: m.tenant.name,
      role: m.role,
      createdAt: m.tenant.createdAt,
    }));
  }
}
