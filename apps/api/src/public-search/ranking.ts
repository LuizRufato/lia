export interface PublicRankCandidate {
  id: string;
  title: string;
  priceCents: number;
  originalPriceCents?: number | null;
  discountBps?: number | null;
  rating?: number | null;
  salesCount?: number | null;
  liaScore?: number | null;
  matchedTokens: number;
  queryTokens: number;
}

export function exactMatchConfidence(candidate: PublicRankCandidate): number {
  if (!candidate.queryTokens) return 0;
  return Math.min(1, candidate.matchedTokens / candidate.queryTokens);
}

export function rankPublicCandidates<T extends PublicRankCandidate>(
  candidates: T[],
): T[] {
  return [...candidates].sort((a, b) => {
    const confidence = exactMatchConfidence(b) - exactMatchConfidence(a);
    if (confidence !== 0) return confidence;

    const score = (b.liaScore ?? 0) - (a.liaScore ?? 0);
    if (score !== 0) return score;

    const rating = (b.rating ?? 0) - (a.rating ?? 0);
    if (rating !== 0) return rating;

    const sales = (b.salesCount ?? 0) - (a.salesCount ?? 0);
    if (sales !== 0) return sales;

    const discount = (b.discountBps ?? 0) - (a.discountBps ?? 0);
    if (discount !== 0) return discount;

    return a.priceCents - b.priceCents;
  });
}
