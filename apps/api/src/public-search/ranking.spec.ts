import { rankPublicCandidates } from './ranking';

describe('public search ranking', () => {
  it('prioritizes exactness before price or commission-like signals', () => {
    const result = rankPublicCandidates([
      {
        id: 'partial',
        title: 'iPhone 16 Pro 256GB',
        priceCents: 100,
        matchedTokens: 2,
        queryTokens: 3,
        liaScore: 99,
      },
      {
        id: 'exact',
        title: 'iPhone 16 128GB',
        priceCents: 500,
        matchedTokens: 3,
        queryTokens: 3,
        liaScore: 70,
      },
    ]);

    expect(result.map((item) => item.id)).toEqual(['exact', 'partial']);
  });
});
