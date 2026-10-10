import type { Config } from './config.js';

export interface WooApiErrorDetails {
  status?: number;
  code?: string;
  message: string;
}

export class WooClientError extends Error {
  readonly status: number;
  readonly wooCode: string | undefined;

  constructor(message: string, status = 500, wooCode?: string) {
    super(message);
    this.name = 'WooClientError';
    this.status = status;
    this.wooCode = wooCode;
  }
}

export class WooStoreClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;
  private readyzCache: { ready: boolean; timestamp: number } | null = null;

  constructor(private readonly config: Config) {
    this.baseUrl = config.WORDPRESS_URL.replace(/\/+$/, '');
    const credentials = Buffer.from(
      `${config.WP_CONSUMER_KEY}:${config.WP_CONSUMER_SECRET}`,
      'utf-8',
    ).toString('base64');
    this.authHeader = `Basic ${credentials}`;
    this.timeoutMs = config.REQUEST_TIMEOUT_MS;
  }

  /**
   * Sanitizes any error message or string so credentials/tokens are never leaked.
   */
  private redactSecrets(str: string): string {
    return str
      .replace(new RegExp(this.config.WP_CONSUMER_KEY, 'g'), '[REDACTED_KEY]')
      .replace(new RegExp(this.config.WP_CONSUMER_SECRET, 'g'), '[REDACTED_SECRET]')
      .replace(new RegExp(this.config.MCP_BEARER_TOKEN, 'g'), '[REDACTED_TOKEN]');
  }

  /**
   * Executes an HTTP request to WooCommerce REST API with retry semantics:
   * - GET requests retry up to 2 times on network failures or 5xx with exponential backoff + jitter.
   * - Mutating requests (POST, PUT, DELETE) are NEVER retried.
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/wp-json/wc/v3/${path.replace(/^\/+/, '')}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const isGet = method === 'GET';
    const maxRetries = isGet ? 2 : 0;
    let attempt = 0;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const headers: Record<string, string> = {
          Authorization: this.authHeader,
          'X-Forwarded-Proto': 'https',
          Accept: 'application/json',
        };
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url.toString(), {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Handle error responses from WooCommerce
        let errorData: WooApiErrorDetails | undefined;
        try {
          const json = (await response.json()) as { code?: string; message?: string };
          errorData = {
            status: response.status,
            code: json.code,
            message: json.message ?? response.statusText,
          };
        } catch {
          errorData = {
            status: response.status,
            message: response.statusText,
          };
        }

        // Retry on 5xx if GET
        if (isGet && response.status >= 500 && attempt < maxRetries) {
          attempt++;
          const backoff = 200 * Math.pow(2, attempt - 1) + Math.random() * 50;
          await new Promise((res) => setTimeout(res, backoff));
          continue;
        }

        const safeMessage = this.redactSecrets(
          errorData.message.replace(/<[^>]+>/g, '').trim() || `WooCommerce returned HTTP ${response.status}`,
        );
        throw new WooClientError(safeMessage, response.status, errorData.code);
      } catch (err) {
        clearTimeout(timer);

        if (err instanceof WooClientError) {
          throw err;
        }

        const isNetworkError =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err.message.includes('fetch failed') ||
            err.message.includes('ECONNREFUSED') ||
            err.message.includes('ETIMEDOUT'));

        if (isGet && isNetworkError && attempt < maxRetries) {
          attempt++;
          const backoff = 200 * Math.pow(2, attempt - 1) + Math.random() * 50;
          await new Promise((res) => setTimeout(res, backoff));
          continue;
        }

        const rawMsg = err instanceof Error ? err.message : String(err);
        const safeMsg = this.redactSecrets(rawMsg);
        throw new WooClientError(
          `Failed to connect to WooCommerce store: ${safeMsg}`,
          502,
          'upstream_unreachable',
        );
      }
    }

    throw new WooClientError('Max retries exceeded connecting to WooCommerce', 504, 'upstream_timeout');
  }

  /**
   * Cached readiness probe checking store reachability (cached 5s).
   */
  async checkReadiness(): Promise<boolean> {
    const now = Date.now();
    if (this.readyzCache && now - this.readyzCache.timestamp < 5000) {
      return this.readyzCache.ready;
    }

    try {
      // Fast check with lightweight query
      await this.request('GET', 'products', { per_page: 1 });
      this.readyzCache = { ready: true, timestamp: now };
      return true;
    } catch {
      this.readyzCache = { ready: false, timestamp: now };
      return false;
    }
  }

  // --- Products ---

  async listProducts(params: {
    search?: string | undefined;
    status?: string | undefined;
    per_page?: number | undefined;
    page?: number | undefined;
  }) {
    return this.request<any[]>('GET', 'products', {
      search: params.search,
      status: params.status,
      per_page: Math.min(params.per_page ?? 10, 50),
      page: params.page ?? 1,
    });
  }

  async getProduct(id: number) {
    return this.request<any>('GET', `products/${id}`);
  }

  async createProduct(data: {
    name: string;
    regular_price: string;
    description?: string | undefined;
    status?: string | undefined;
    sku?: string | undefined;
    client_reference?: string | undefined;
  }) {
    const payload: Record<string, unknown> = {
      name: data.name,
      regular_price: data.regular_price,
      status: data.status ?? 'publish',
    };
    if (data.description !== undefined) {
      payload.description = data.description;
    }
    if (data.sku !== undefined) {
      payload.sku = data.sku;
    }
    if (data.client_reference !== undefined) {
      payload.meta_data = [{ key: '_conduit_client_ref', value: data.client_reference }];
    }
    return this.request<any>('POST', 'products', undefined, payload);
  }

  async updateProduct(
    id: number,
    data: {
      name?: string | undefined;
      regular_price?: string | undefined;
      description?: string | undefined;
      status?: string | undefined;
      sku?: string | undefined;
    },
  ) {
    return this.request<any>('PUT', `products/${id}`, undefined, data);
  }

  // --- Orders ---

  async listOrders(params: {
    status?: string | undefined;
    after?: string | undefined;
    before?: string | undefined;
    per_page?: number | undefined;
    page?: number | undefined;
  }) {
    return this.request<any[]>('GET', 'orders', {
      status: params.status,
      after: params.after,
      before: params.before,
      per_page: Math.min(params.per_page ?? 10, 50),
      page: params.page ?? 1,
    });
  }

  async getOrder(id: number) {
    return this.request<any>('GET', `orders/${id}`);
  }

  async updateOrderStatus(id: number, status: string) {
    return this.request<any>('PUT', `orders/${id}`, undefined, { status });
  }

  async getSalesReports(period?: string) {
    return this.request<any[]>('GET', 'reports/sales', {
      period: period ?? 'year',
    });
  }
}
