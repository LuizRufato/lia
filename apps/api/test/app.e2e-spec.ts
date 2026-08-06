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

  beforeAll(async () => {
    testHash = await bcrypt.hash('test', 10);
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        adminUser: { 
          findUnique: jest.fn().mockResolvedValue({
            id: '123',
            email: 'test@test.com',
            passwordHash: testHash
          })
        },
        $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
      })
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
    return request(app.getHttpServer())
      .get('/health')
      .expect(200);
  });

  it('/auth/login (POST) should return 401 with wrong credentials', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@test.com', password: 'wrongpassword' })
      .expect(401); 
  });

  it('/auth/me (GET) should be protected and return 401 without auth', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .expect(401);
  });

  it('/auth/login (POST) should login and return cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@test.com', password: 'test' })
      .expect(200);
      
    expect(response.headers['set-cookie']).toBeDefined();
    validToken = response.headers['set-cookie'][0];
  });

  it('/auth/me (GET) should be accessible with auth cookie', () => {
    return request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', validToken)
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });
});
