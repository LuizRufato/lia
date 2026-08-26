import { IsString, Length } from 'class-validator';

export class PublicSearchDto {
  @IsString()
  @Length(2, 500)
  query!: string;
}
