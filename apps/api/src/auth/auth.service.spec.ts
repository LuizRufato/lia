import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as bcrypt from 'bcryptjs';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    adminUser: { findUnique: jest.Mock };
    tenantMembership: { findFirst: jest.Mock };
  };
  let jwt: { sign: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: (jwt = { sign: jest.fn() }) },
        {
          provide: PrismaService,
          useValue: (prisma = {
            adminUser: { findUnique: jest.fn() },
            tenantMembership: { findFirst: jest.fn() },
          }),
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('normalizes the email and emits a tenant-bound session', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash,
    });
    prisma.tenantMembership.findFirst.mockResolvedValue({
      id: 'membership-1',
      tenantId: 'tenant-1',
      role: 'OWNER',
    });
    jwt.sign.mockReturnValue('token-1');

    await expect(
      service.login({
        email: '  USER@EXAMPLE.COM ',
        password: 'correct-password',
      }),
    ).resolves.toEqual({ accessToken: 'token-1' });

    expect(prisma.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'user@example.com' },
    });
    expect(jwt.sign).toHaveBeenCalledWith({
      email: 'user@example.com',
      sub: 'user-1',
      tenantId: 'tenant-1',
      role: 'OWNER',
    });
  });

  it('does not issue a session to an admin without membership', async () => {
    const passwordHash = await bcrypt.hash('correct-password', 4);
    prisma.adminUser.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      passwordHash,
    });
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(
      service.login({
        email: 'user@example.com',
        password: 'correct-password',
      }),
    ).rejects.toThrow('não pertence a nenhum tenant');
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
