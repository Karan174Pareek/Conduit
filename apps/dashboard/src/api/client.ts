export class ApiError extends Error {
  code: string;
  statusCode: number;
  requestId?: string;

  constructor(message: string, statusCode: number, code: string = 'api_error', requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.requestId = requestId;
  }
}

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export async function apiFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  // Mutating requests require CSRF token and origin header
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    if (inMemoryCsrfToken) {
      headers.set('x-csrf-token', inMemoryCsrfToken);
    }
    if (typeof window !== 'undefined') {
      headers.set('origin', window.location.origin);
    }
  }

  // Automatically ensure content-type is set when body is passed
  if (options.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const requestId = response.headers.get('x-request-id') || undefined;

  // Handle 401 Unauthorized
  if (response.status === 401 && !endpoint.includes('/api/auth/login') && !endpoint.includes('/api/auth/me')) {
    setCsrfToken(null);
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/accept-invite')) {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?returnTo=${returnTo}`;
    }
  }

  // Handle non-OK status
  if (!response.ok) {
    let errorJson: { message?: string; code?: string; requestId?: string } = {};
    try {
      errorJson = await response.json();
    } catch {
      // Fallback if not json
    }

    const message = errorJson.message || `Request failed with status ${response.status}`;
    const code = errorJson.code || 'http_error';
    const reqId = errorJson.requestId || requestId;

    throw new ApiError(message, response.status, code, reqId);
  }

  // 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get: <T = any>(url: string): Promise<T> => apiFetch<T>(url, { method: 'GET' }),
  post: <T = any>(url: string, body?: unknown): Promise<T> =>
    apiFetch<T>(url, {
      method: 'POST',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T = any>(url: string, body?: unknown): Promise<T> =>
    apiFetch<T>(url, {
      method: 'PUT',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T = any>(url: string, body?: unknown): Promise<T> =>
    apiFetch<T>(url, {
      method: 'PATCH',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T = any>(url: string): Promise<T> => apiFetch<T>(url, { method: 'DELETE' }),
};
