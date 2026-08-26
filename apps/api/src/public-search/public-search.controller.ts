import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PublicSearchDto } from './dto/public-search.dto';
import { PublicSearchService } from './public-search.service';

@Public()
@Controller('public/search')
export class PublicSearchController {
  constructor(private readonly publicSearchService: PublicSearchService) {}

  @Post()
  search(@Body() body: PublicSearchDto) {
    return this.publicSearchService.search(body.query);
  }

  @Get('featured')
  featured() {
    return this.publicSearchService.featured();
  }
}
