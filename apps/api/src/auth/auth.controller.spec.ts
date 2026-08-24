import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import type { Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalCookieDomain === undefined) delete process.env.AUTH_COOKIE_DOMAIN;
    else process.env.AUTH_COOKIE_DOMAIN = originalCookieDomain;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue({ accessToken: 'token-1' }),
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('sets and clears the HttpOnly cookie using the same path', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_COOKIE_DOMAIN = 'botlia.com.br';
    const response = { cookie: jest.fn() } as unknown as Response;

    await controller.login(
      { email: 'user@example.com', password: 'correct-password' },
      response,
    );
    controller.logout(response);

    expect(response.cookie).toHaveBeenNthCalledWith(
      1,
      'Authentication',
      'token-1',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        domain: 'botlia.com.br',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
        sameSite: 'strict',
      }),
    );
    expect(response.cookie).toHaveBeenNthCalledWith(
      2,
      'Authentication',
      '',
      expect.objectContaining({
        expires: expect.any(Date),
        maxAge: 0,
        secure: true,
        domain: 'botlia.com.br',
        path: '/',
      }),
    );
  });
});
