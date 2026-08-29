import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import {
  MetaAcquisitionController,
  MetaConnectionController,
  PublicAcquisitionGroupController,
} from './meta-acquisition.controller';
import {
  GroupProvisioningService,
  GroupRouterService,
  MetaAcquisitionService,
} from './meta-acquisition.service';

export interface MetaMarketingProvider {
  listAssets(accessToken: string): Promise<unknown[]>;
  createCampaign(): Promise<never>;
}

export class ReadOnlyMetaMarketingProvider implements MetaMarketingProvider {
  async listAssets(_accessToken: string): Promise<unknown[]> {
    throw new Error('Meta asset discovery ainda não está configurada.');
  }

  async createCampaign(): Promise<never> {
    throw new Error('Meta campaign write está desabilitado nesta fase.');
  }
}

@Module({
  imports: [PrismaModule],
  controllers: [
    MetaAcquisitionController,
    MetaConnectionController,
    PublicAcquisitionGroupController,
  ],
  providers: [
    MetaAcquisitionService,
    GroupRouterService,
    GroupProvisioningService,
    {
      provide: 'META_MARKETING_PROVIDER',
      useClass: ReadOnlyMetaMarketingProvider,
    },
  ],
  exports: [
    MetaAcquisitionService,
    GroupRouterService,
    GroupProvisioningService,
  ],
})
export class MetaAcquisitionModule {}
