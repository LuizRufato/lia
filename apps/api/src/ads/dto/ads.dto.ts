import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAdvertiserDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string;
}

export class UpdateAdvertiserDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  companyName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string | null;

  @IsOptional()
  @IsEnum(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

export class CreateCampaignDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(100)
  advertiserId!: string;

  @IsString()
  @MaxLength(100)
  offerId!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  bidCpcCents!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  totalBudgetCents!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  dailyBudgetCents!: number;

  @IsDateString()
  startAt!: string;

  @IsDateString()
  endAt!: string;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  advertiserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  offerId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  bidCpcCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  totalBudgetCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000_000_000)
  dailyBudgetCents?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}

export class RejectCampaignDto {
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class AddCreditDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  amountCents!: number;

  @IsString()
  @MaxLength(300)
  reason!: string;

  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;
}

export class UpdateAdsSettingsDto {
  @IsOptional()
  @IsBoolean()
  adsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  adsPublicSearchEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  adsBillingEnabled?: boolean;
}
