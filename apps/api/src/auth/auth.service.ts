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
    const user = await this.prisma.adminUser.findUnique({
      where: { email: loginDto.email },
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
    });

    const tenantId = membership ? membership.tenantId : null;

    const payload = { email: user.email, sub: user.id, tenantId };

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
