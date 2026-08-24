import { MercadoLivreApiError, MercadoLivreClient } from './mercadolivre.client';

describe('MercadoLivreClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('requests active user item ids with the controlled limit', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: ['MLB1'], paging: { total: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await new MercadoLivreClient().searchActiveItemIds('123', 'token', 50);
    expect(result.results).toEqual(['MLB1']);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/users/123/items/search?status=active&limit=50'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    );
  });

  it('retries 429 with bounded backoff and succeeds', async () => {
    jest.useFakeTimers();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    global.fetch = fetchMock;

    const promise = new MercadoLivreClient().getItems(['MLB1'], 'token');
    await jest.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });

  it('does not retry a 401; the caller owns the single refresh retry', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(new MercadoLivreClient().getItems(['MLB1'], 'token')).rejects.toEqual(
      expect.objectContaining<MercadoLivreApiError>({ status: 401 }),
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
