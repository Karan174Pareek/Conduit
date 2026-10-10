import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WooStoreClient } from '../src/store-client.js';
import type { Config } from '../src/config.js';

describe('WooStoreClient', () => {
  const mockConfig: Config = {
    PORT: 3100,
    HOST: '0.0.0.0',
    MCP_BEARER_TOKEN: 'token-secret-12345',
    WP_CONSUMER_KEY: 'ck_my_secret_key',
    WP_CONSUMER_SECRET: 'cs_my_secret_secret',
    WORDPRESS_URL: 'http://wordpress.local',
    STORE_TIMEZONE: 'Asia/Kolkata',
    REQUEST_TIMEOUT_MS: 1000,
  };

  let client: WooStoreClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new WooStoreClient(mockConfig);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('redacts secrets from error messages', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({
        message: 'Invalid key ck_my_secret_key and secret cs_my_secret_secret',
      }),
    } as any);

    await expect(client.getProduct(1)).rejects.toThrowError(
      'Invalid key [REDACTED_KEY] and secret [REDACTED_SECRET]',
    );
  });

  it('retries GET requests up to 2 times on 500 error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ message: 'Temporary failure' }),
      } as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ message: 'Temporary gateway issue' }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 42, name: 'Recovered Product' }),
      } as any);

    globalThis.fetch = fetchMock;

    const res = await client.getProduct(42);
    expect(res).toEqual({ id: 42, name: 'Recovered Product' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry POST requests on 500 error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({ message: 'Cannot create product' }),
    } as any);

    globalThis.fetch = fetchMock;

    await expect(
      client.createProduct({ name: 'New Item', regular_price: '19.99' }),
    ).rejects.toThrowError('Cannot create product');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends Basic auth header and X-Forwarded-Proto', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn().mockImplementation(async (_url, opts) => {
      capturedHeaders = opts.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        json: async () => [],
      };
    });

    await client.listProducts({});
    expect(capturedHeaders['X-Forwarded-Proto']).toBe('https');
    expect(capturedHeaders['Authorization']).toMatch(/^Basic /);
  });

  it('caches checkReadiness response for 5 seconds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 1 }],
    } as any);

    globalThis.fetch = fetchMock;

    const r1 = await client.checkReadiness();
    const r2 = await client.checkReadiness();
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
