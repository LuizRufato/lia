import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AdsAuditService } from './ads-audit.service';
import { CreateAdvertiserDto, UpdateAdvertiserDto } from './dto/ads.dto';
import { assertAdsAdmin, publicAdvertiserState } from './ads.utils';

const advertiserInclude = {
  balance: { select: { availableCents: true, reservedCents: true } },
  _count: { select: { campaigns: true } },
} as const;

@Injectable()
export class AdvertisersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdsAuditService,
  ) {}

  async list(tenantId: string) {
    const advertisers = await this.prisma.advertiser.findMany({
      where: { tenantId },
      include: advertiserInclude,
      orderBy: { createdAt: 'desc' },
    });
    return advertisers.map((advertiser) => this.toView(advertiser));
  }

  async get(tenantId: string, id: string) {
    const advertiser = await this.prisma.advertiser.findFirst({
      where: { id, tenantId },
      include: advertiserInclude,
    });
    if (!advertiser) throw new NotFoundException('Anunciante não encontrado.');
    return this.toView(advertiser);
  }

  async create(
    tenantId: string,
    adminUserId: string,
    role: string,
    body: CreateAdvertiserDto,
  ) {
    assertAdsAdmin(role);
    const name = body.name.trim();
    if (!name)
      throw new BadRequestException('Nome do anunciante é obrigatório.');

    const advertiser = await this.prisma.$transaction(async (tx) => {
      const created = await tx.advertiser.create({
        data: {
          tenantId,
          name,
          companyName: body.companyName?.trim() || undefined,
          contactName: body.contactName?.trim() || undefined,
          contactEmail: body.contactEmail?.trim() || undefined,
          contactPhone: body.contactPhone?.trim() || undefined,
        },
        include: advertiserInclude,
      });
      await this.audit.record(tx, {
        tenantId,
        advertiserId: created.id,
        adminUserId,
        action: 'ADVERTISER_CREATED',
        entityType: 'Advertiser',
        entityId: created.id,
        newState: publicAdvertiserState(created),
      });
      return created;
    });
    return this.toView(advertiser);
  }

  async update(
    tenantId: string,
    adminUserId: string,
    role: string,
    id: string,
    body: UpdateAdvertiserDto,
  ) {
    assertAdsAdmin(role);
    const existing = await this.prisma.advertiser.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Anunciante não encontrado.');
    if (body.name !== undefined && !body.name.trim()) {
      throw new BadRequestException('Nome do anunciante é obrigatório.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const value = await tx.advertiser.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.companyName !== undefined && {
            companyName: body.companyName?.trim() || null,
          }),
          ...(body.contactName !== undefined && {
            contactName: body.contactName?.trim() || null,
          }),
          ...(body.contactEmail !== undefined && {
            contactEmail: body.contactEmail?.trim() || null,
          }),
          ...(body.contactPhone !== undefined && {
            contactPhone: body.contactPhone?.trim() || null,
          }),
          ...(body.status !== undefined && { status: body.status }),
        },
        include: advertiserInclude,
      });
      await this.audit.record(tx, {
        tenantId,
        advertiserId: id,
        adminUserId,
        action:
          body.status === 'SUSPENDED'
            ? 'ADVERTISER_SUSPENDED'
            : 'ADVERTISER_UPDATED',
        entityType: 'Advertiser',
        entityId: id,
        previousState: publicAdvertiserState(existing),
        newState: publicAdvertiserState(value),
      });
      return value;
    });
    return this.toView(updated);
  }

  private toView(advertiser: any) {
    return {
      id: advertiser.id,
      name: advertiser.name,
      companyName: advertiser.companyName,
      contactName: advertiser.contactName,
      contactEmail: advertiser.contactEmail,
      contactPhone: advertiser.contactPhone,
      status: advertiser.status,
      balance: {
        availableCents: advertiser.balance?.availableCents ?? 0,
        reservedCents: advertiser.balance?.reservedCents ?? 0,
      },
      campaignCount: advertiser._count?.campaigns ?? 0,
      createdAt: advertiser.createdAt,
      updatedAt: advertiser.updatedAt,
    };
  }
}
