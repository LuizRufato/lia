import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  console.log("Meli RPA Service Started");
  // It's a worker, so it just stays alive
}
bootstrap();
