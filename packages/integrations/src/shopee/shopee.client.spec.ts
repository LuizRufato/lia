import { ShopeeAffiliateClient } from "./shopee.client";
import axios from "axios";
import * as crypto from "crypto";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("ShopeeAffiliateClient", () => {
  let client: ShopeeAffiliateClient;
  const appId = "app123";
  const appSecret = "secret123";

  beforeEach(() => {
    client = new ShopeeAffiliateClient(appId, appSecret);
    jest.clearAllMocks();
  });

  it("should generate SHA256 signature correctly", () => {
    const timestamp = 1700000000;
    const payload = '{"test":"payload"}';
    const signature = client.generateSignature(payload, timestamp);

    // Formula: SHA256(AppId + Timestamp + Payload + Secret)
    const expectedBase = `${appId}${timestamp}${payload}${appSecret}`;
    const expectedHash = crypto
      .createHash("sha256")
      .update(expectedBase, "utf8")
      .digest("hex")
      .toLowerCase();

    expect(signature).toBe(expectedHash);
  });

  it("should format Authorization header and NOT stringify payload twice", async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { data: {} } });

    // Fix timestamp for predictable signature
    const realDateNow = Date.now.bind(global.Date);
    global.Date.now = jest.fn(() => 1700000000 * 1000); // 1700000000 seconds

    await client.getProductOfferV2(1, 20, 5);

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, bodyStr, config] = mockedAxios.post.mock.calls[0];

    expect(url).toBe("https://open-api.affiliate.shopee.com.br/graphql");
    expect(typeof bodyStr).toBe("string");

    const signature = client.generateSignature(bodyStr as string, 1700000000);
    expect(config?.headers?.Authorization).toBe(
      `SHA256 Credential=${appId}, Timestamp=1700000000, Signature=${signature}`,
    );

    global.Date.now = realDateNow;
  });

  it("should throw Error if GraphQL returns HTTP 200 with errors", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: null,
        errors: [
          {
            message: "Token is invalid",
            extensions: { code: 10020, message: "Token is invalid" },
          },
        ],
      },
    });

    await expect(client.getProductOfferV2()).rejects.toThrow(
      "Authentication/Credential Error: Token is invalid",
    );
  });

  it("should throw Rate Limit Error for HTTP 429", async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 429 },
    });

    await expect(client.getProductOfferV2()).rejects.toThrow(
      "Shopee Rate Limit Exceeded (10030)",
    );
  });

  it("should send conversion pagination limit and cursor as request variables", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        data: {
          conversionReport: {
            nodes: [],
            pageInfo: { hasNextPage: false, limit: 500 },
          },
        },
      },
    });

    await client.getConversionReport(1, 2, 500, "cursor-page-2");

    const [, bodyStr] = mockedAxios.post.mock.calls[0];
    const body = JSON.parse(bodyStr as string);
    expect(body.query).toContain(
      "$purchaseTimeStart: Int64!, $purchaseTimeEnd: Int64!",
    );
    expect(body.query).not.toContain("$purchaseTimeStart: Int!");
    expect(body.query).not.toContain("$purchaseTimeEnd: Int!");
    expect(body.query).not.toContain("campaignType");
    expect(body.query).toContain("conversionId");
    expect(body.query).toContain("orders");
    expect(body.query).toContain("itemId");
    expect(body.variables).toEqual({
      purchaseTimeStart: "1",
      purchaseTimeEnd: "2",
      limit: 500,
      scrollId: "cursor-page-2",
    });
  });
});
