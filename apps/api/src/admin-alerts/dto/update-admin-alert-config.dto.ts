import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAdminAlertConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  recipient?: string;

  @IsOptional()
  @IsBoolean()
  removeRecipient?: boolean;

  @IsOptional()
  @IsBoolean()
  newShopeeSaleEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  commissionConfirmedEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  saleCancelledEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  highValueSaleEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  criticalErrorEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  dailySummaryEnabled?: boolean;
}
