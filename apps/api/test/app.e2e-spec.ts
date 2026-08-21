import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma.service';

import { PrismaHealthIndicator } from '@nestjs/terminus';
import { RedisHealthIndicator } from './../src/health/redis.health';

import * as bcrypt from 'bcryptjs';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let testHash: string;
  let validToken: string;
  let prismaMock: any;

  beforeAll(async () => {
    testHash = await bcrypt.hash('testpassword', 10);
  });

  beforeEach(async () => {
    prismaMock = {
      adminUser: {
        findUnique: jest.fn().mockResolvedValue({
          id: '123',
          email: 'test@test.com',
          passwordHash: testHash,
        }),
      },
      tenantMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-1',
          tenantId: 'tenant-1',
          role: 'OWNER',
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(PrismaHealthIndicator)
      .useValue({
        pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
      })
      .overrideProvider(RedisHealthIndicator)
      .useValue({
        pingCheck: jest.fn().mockResolvedValue({ redis: { status: 'up' } }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(require('cookie-parser')());
    await app.init();
  });

  it('/health (GET) should be accessible without auth', () => {
    return request(app.getHttpServer()).get('/health').expect(200);
  });

  it('/auth/login (POST) should return 401 with wrong credentials', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@test.com', password: 'wrongpassword' })
      .expect(401);
  });

  it('/auth/me (GET) should be protected and return 401 without auth', () => {
    return request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('/auth/login (POST) should login and return cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: '  TEST@TEST.COM ', password: 'testpassword' })
      .expect(200);

    expect(response.headers['set-cookie']).toBeDefined();
    validToken = response.headers['set-cookie'][0];
    expect(prismaMock.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: 'test@test.com' },
    });
  });

  it('/auth/me (GET) should be accessible with auth cookie', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', validToken)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          id: '123',
          email: 'test@test.com',
          tenantId: 'tenant-1',
          role: 'OWNER',
        });
      });
  });

  it('/auth/logout (POST) clears the session and protected routes reject it', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@test.com', password: 'testpassword' })
      .expect(200);
    const cookie = login.headers['set-cookie'][0];

    const logout = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', cookie)
      .expect(200);

    expect(logout.headers['set-cookie'][0]).toContain('Authentication=');
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('/auth/login (POST) rejects an admin without tenant membership', async () => {
    prismaMock.tenantMembership.findFirst.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@test.com', password: 'testpassword' })
      .expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
