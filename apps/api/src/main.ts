import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { getEncryptionKey } from '@lia/integrations';

async function bootstrap() {
  // Validate integration encryption key before starting
  try {
    getEncryptionKey();
  } catch (error: any) {
    console.error(
      'FATAL ERROR: Failed to load INTEGRATION_ENCRYPTION_KEY:',
      error.message,
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  // Security
  app.use(helmet());
  app.enableCors({
    origin: process.env.WEB_URL || 'http://localhost:3001',
    credentials: true,
  });

  // Parsers
  app.use(cookieParser());

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
