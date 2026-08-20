export class MeliCatalogProvider {
  constructor(private readonly accessToken: string) {}

  async getHighlights(categoryId: string): Promise<any[]> {
    // Official endpoint: /highlights/MLB/category/{CATEGORY_ID}
    // Will be implemented later with axios.
    // For now, return empty stub.
    return [];
  }

  async getItemDetails(itemIds: string[]): Promise<any[]> {
    // Official endpoint: /items?ids=...
    return [];
  }
}

export class MeliAffiliateLinkProvider {
  public readonly status = "UNAVAILABLE";

  generateAffiliateLink(url: string, subIds?: Record<string, string>): string {
    throw new Error(
      "MeliAffiliateLinkProvider is currently UNAVAILABLE pending official API documentation.",
    );
  }
}

export class MeliAffiliateMetricsProvider {
  public readonly status = "UNAVAILABLE";

  async getMetrics(): Promise<any> {
    throw new Error(
      "MeliAffiliateMetricsProvider is currently UNAVAILABLE pending official API documentation.",
    );
  }
}
