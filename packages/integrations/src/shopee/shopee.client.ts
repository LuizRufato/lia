import axios from "axios";
import * as crypto from "crypto";
import {
  ShopeeProductOfferResponse,
  ShopeeGenerateShortLinkResponse,
  ShopeeConversionResponse,
} from "./shopee.types";

export class ShopeeAffiliateClient {
  private appId: string;
  private appSecret: string;
  private baseUrl: string;

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.baseUrl = "https://open-api.affiliate.shopee.com.br/graphql";
  }

  /**
   * Generates the required SHA256 signature for Shopee Affiliate API
   * Formula: SHA256(AppId + Timestamp + Payload + Secret)
   * Hexadecimal, lowercase, 64 chars
   */
  public generateSignature(payload: string, timestamp: number): string {
    const baseString = `${this.appId}${timestamp}${payload}${this.appSecret}`;
    return crypto
      .createHash("sha256")
      .update(baseString, "utf8")
      .digest("hex")
      .toLowerCase();
  }

  public async getProductOfferV2(
    page: number = 1,
    limit: number = 20,
    sortType: number = 5,
  ): Promise<ShopeeProductOfferResponse> {
    const timestamp = Math.floor(Date.now() / 1000);

    // Exact body format required by GraphQL
    const bodyObj = {
      query: `
        query productOfferV2($page: Int!, $limit: Int!, $sortType: Int) {
          productOfferV2(page: $page, limit: $limit, sortType: $sortType) {
            nodes {
              itemId
              commissionRate
              sellerCommissionRate
              shopeeCommissionRate
              commission
              sales
              priceMax
              priceMin
              productCatIds
              ratingStar
              priceDiscountRate
              imageUrl
              productName
              shopId
              shopName
              shopType
              productLink
              offerLink
              periodStartTime
              periodEndTime
            }
            pageInfo {
              page
              limit
              hasNextPage
            }
          }
        }
      `,
      variables: {
        page,
        limit,
        sortType,
      },
    };

    // Serialize payload exactly ONCE
    const payload = JSON.stringify(bodyObj);

    const signature = this.generateSignature(payload, timestamp);
    const authorization = `SHA256 Credential=${this.appId}, Timestamp=${timestamp}, Signature=${signature}`;

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        timeout: 15000,
      });

      const data = response.data;

      // Handle GraphQL errors even with HTTP 200
      if (data.errors && data.errors.length > 0) {
        const firstError = data.errors[0];
        const errorCode = firstError.extensions?.code;
        const errorMessage =
          firstError.extensions?.message || firstError.message;

        throw this.mapGraphQLShopeeError(errorCode, errorMessage);
      }

      return data;
    } catch (error: any) {
      if (error.response && error.response.status === 429) {
        throw new Error("Shopee Rate Limit Exceeded (10030)");
      }
      throw error;
    }
  }

  public async generateShortLink(
    originUrl: string,
    subIds: string[] = [],
  ): Promise<ShopeeGenerateShortLinkResponse> {
    const timestamp = Math.floor(Date.now() / 1000);

    const bodyObj = {
      query: `
        mutation generateShortLink($originUrl: String!, $subIds: [String!]) {
          generateShortLink(input: { originUrl: $originUrl, subIds: $subIds }) {
            shortLink
          }
        }
      `,
      variables: {
        originUrl,
        subIds,
      },
    };

    const payload = JSON.stringify(bodyObj);
    const signature = this.generateSignature(payload, timestamp);
    const authorization = `SHA256 Credential=${this.appId}, Timestamp=${timestamp}, Signature=${signature}`;

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        timeout: 15000,
      });

      const data = response.data;

      if (data.errors && data.errors.length > 0) {
        const firstError = data.errors[0];
        const errorCode = firstError.extensions?.code;
        const errorMessage =
          firstError.extensions?.message || firstError.message;

        throw this.mapGraphQLShopeeError(errorCode, errorMessage);
      }

      return data;
    } catch (error: any) {
      if (error.response && error.response.status === 429) {
        throw new Error("Shopee Rate Limit Exceeded (10030)");
      }
      throw error;
    }
  }

  public async getConversionReport(
    purchaseTimeStart: number,
    purchaseTimeEnd: number,
    limit: number = 20,
    scrollId?: string,
  ): Promise<ShopeeConversionResponse> {
    const timestamp = Math.floor(Date.now() / 1000);

    const bodyObj = {
      query: `
        query conversionReport($purchaseTimeStart: Int!, $purchaseTimeEnd: Int!, $limit: Int!, $scrollId: String) {
          conversionReport(purchaseTimeStart: $purchaseTimeStart, purchaseTimeEnd: $purchaseTimeEnd, limit: $limit, scrollId: $scrollId) {
            nodes {
              conversionId
              purchaseTime
              clickTime
              shopeeCommissionCapped
              sellerCommission
              totalCommission
              netCommission
              utmContent
              buyerType
              device
              campaignType
              orders {
                orderId
                orderStatus
                shopType
                items {
                  itemId
                  itemName
                  itemPrice
                  actualAmount
                  qty
                  itemTotalCommission
                  itemSellerCommission
                  itemSellerCommissionRate
                  itemShopeeCommissionCapped
                  itemShopeeCommissionRate
                  displayItemStatus
                  fraudStatus
                  globalCategoryLv1Name
                  globalCategoryLv2Name
                  globalCategoryLv3Name
                  modelId
                  promotionId
                }
              }
            }
            pageInfo {
              limit
              scrollId
              hasNextPage
            }
          }
        }
      `,
      variables: {
        purchaseTimeStart,
        purchaseTimeEnd,
        limit,
        ...(scrollId && { scrollId }),
      },
    };

    const payload = JSON.stringify(bodyObj);
    const signature = this.generateSignature(payload, timestamp);
    const authorization = `SHA256 Credential=${this.appId}, Timestamp=${timestamp}, Signature=${signature}`;

    try {
      const response = await axios.post(this.baseUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        timeout: 15000,
      });

      const data = response.data;

      if (data.errors && data.errors.length > 0) {
        const firstError = data.errors[0];
        const errorCode = firstError.extensions?.code;
        const errorMessage =
          firstError.extensions?.message || firstError.message;

        throw this.mapGraphQLShopeeError(errorCode, errorMessage);
      }

      return data;
    } catch (error: any) {
      if (error.response && error.response.status === 429) {
        throw new Error("Shopee Rate Limit Exceeded (10030)");
      }
      throw error;
    }
  }

  private mapGraphQLShopeeError(code: number | string, message: string): Error {
    const codeNum = typeof code === "string" ? parseInt(code, 10) : code;
    let errorPrefix = "Shopee GraphQL Error";

    switch (codeNum) {
      case 11000:
        errorPrefix = "Business Error";
        break;
      case 11001:
        errorPrefix = "Params Error";
        break;
      case 11002:
        errorPrefix = "Bind Account Error";
        break;
      case 10020:
        errorPrefix = "Authentication/Credential Error";
        break;
      case 10030:
        errorPrefix = "Rate limit exceeded";
        break;
      case 10031:
        errorPrefix = "Access denied";
        break;
      case 10032:
        errorPrefix = "Invalid affiliate id";
        break;
      case 10033:
        errorPrefix = "Account frozen";
        break;
      case 10034:
        errorPrefix = "Affiliate blacklisted";
        break;
      case 10035:
        errorPrefix = "Affiliate Open API access unavailable";
        break;
      default:
        errorPrefix = `Shopee GraphQL Error (${code})`;
        break;
    }

    const err = new Error(`${errorPrefix}: ${message}`);
    (err as any).code = code;
    return err;
  }
}
