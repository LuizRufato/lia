export type ChannelVisibility = "PUBLIC" | "PRIVATE";

export class MarketplacePublicationPolicy {
  /**
   * Evaluates if a given marketplace allows publishing to a channel with a specific visibility.
   * @param marketplace The marketplace provider (e.g., 'MERCADO_LIVRE', 'SHOPEE')
   * @param channelVisibility The visibility of the target channel ('PUBLIC' or 'PRIVATE')
   * @returns true if allowed, false if blocked by policy
   */
  static canPublish(
    marketplace: string,
    channelVisibility: ChannelVisibility,
  ): boolean {
    if (marketplace === "MERCADO_LIVRE") {
      // Mercado Livre affiliate rules explicitly forbid private groups.
      return channelVisibility === "PUBLIC";
    }

    // Other marketplaces (e.g. Shopee) might allow both by default for now
    return true;
  }
}
