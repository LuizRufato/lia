import { Module } from '@nestjs/common';
import { OffersModule } from '../offers/offers.module';
import { PrismaModule } from '../prisma.module';
import { PublicSearchController } from './public-search.controller';
import { PublicSearchService } from './public-search.service';

@Module({
  imports: [PrismaModule, OffersModule],
  controllers: [PublicSearchController],
  providers: [PublicSearchService],
})
export class PublicSearchModule {}
