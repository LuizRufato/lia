import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AdminCommandService } from './admin/admin-command/admin-command.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const adminCommandService = app.get(AdminCommandService);
  
  try {
    await adminCommandService.run();
  } catch (error) {
    console.error('Erro na execução do comando:', error.message);
  } finally {
    await app.close();
    process.exit(0);
  }
}

bootstrap();
