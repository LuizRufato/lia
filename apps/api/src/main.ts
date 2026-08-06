import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import * as cookieParserImport from 'cookie-parser';
const cookieParser = cookieParserImport as any;
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
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
bootstrap();

