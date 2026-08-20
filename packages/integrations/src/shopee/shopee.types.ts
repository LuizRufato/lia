export interface ShopeeProductOfferItemV2 {
  itemId: number;
  commissionRate: string;
  sellerCommissionRate: string;
  shopeeCommissionRate: string;
  commission: string;
  sales: number;
  priceMax: string;
  priceMin: string;
  productCatIds: number[];
  ratingStar: number;
  priceDiscountRate: number;
  imageUrl: string;
  productName: string;
  shopId: number;
  shopName: string;
  shopType: number[];
  productLink: string;
  offerLink: string;
  periodStartTime: number;
  periodEndTime: number;
}

export interface ShopeeProductOfferResponse {
  data: {
    productOfferV2?: {
      nodes: ShopeeProductOfferItemV2[];
      pageInfo: {
        page: number;
        limit: number;
        hasNextPage: boolean;
      };
    };
  };
  errors?: Array<{
    message: string;
    extensions?: {
      code: string | number;
      message: string;
    };
  }>;
}

export interface ShopeeGenerateShortLinkResponse {
  data: {
    generateShortLink?: {
      shortLink: string;
    };
  };
  errors?: Array<{
    message: string;
    extensions?: {
      code: string | number;
      message: string;
    };
  }>;
}

export interface ShopeeConversionItem {
  itemId: string;
  itemName: string;
  itemPrice: string;
  actualAmount: string;
  qty: number;
  itemTotalCommission: string;
  itemSellerCommission: string;
  itemSellerCommissionRate: string;
  itemShopeeCommissionCapped: string;
  itemShopeeCommissionRate: string;
  displayItemStatus: string;
  fraudStatus: string;
  globalCategoryLv1Name?: string;
  globalCategoryLv2Name?: string;
  globalCategoryLv3Name?: string;
  modelId?: string;
  promotionId?: string;
}

export interface ShopeeConversionOrder {
  orderId: string;
  orderStatus: string;
  shopType?: string;
  items: ShopeeConversionItem[];
}

export interface ShopeeConversionNode {
  conversionId: string;
  purchaseTime: number;
  clickTime: number;
  shopeeCommissionCapped: string;
  sellerCommission: string;
  totalCommission: string;
  netCommission: string;
  utmContent: string[];
  buyerType: number;
  device: string;
  campaignType: string;
  orders: ShopeeConversionOrder[];
}

export interface ShopeeConversionResponse {
  data: {
    conversionReport?: {
      nodes: ShopeeConversionNode[];
      pageInfo: {
        hasNextPage: boolean;
        scrollId: string;
        limit: number;
      };
    };
  };
  errors?: Array<{
    message: string;
    extensions?: {
      code: string | number;
      message: string;
    };
  }>;
}
