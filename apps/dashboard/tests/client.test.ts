// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { apiFetch, setCsrfToken, getCsrfToken, ApiError, apiClient } from '../src/api/client';

describe('Dashboard API Client', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps non-OK HTTP responses to ApiError with requestId', async () => {
    const mockHeaders = new Headers({
      'content-type': 'application/json',
      'x-request-id': 'req-err-1234',
    });

    const mockResponse = {
      ok: false,
      status: 400,
      headers: mockHeaders,
      json: async () => ({
        code: 'validation_failed',
        message: 'Invalid email address provided',
      }),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await expect(apiFetch('/api/test')).rejects.toThrowError(ApiError);

    try {
      await apiFetch('/api/test');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('validation_failed');
      expect(err.message).toBe('Invalid email address provided');
      expect(err.requestId).toBe('req-err-1234');
    }
  });

  it('automatically injects x-csrf-token and origin on mutating requests', async () => {
    setCsrfToken('mock-csrf-token-xyz');

    let capturedHeaders: Headers | undefined;
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init) => {
        capturedHeaders = new Headers(init.headers);
        return Promise.resolve(mockResponse);
      }),
    );

    // GET request should not have CSRF token
    await apiClient.get('/api/servers');
    expect(capturedHeaders?.get('x-csrf-token')).toBeNull();

    // POST request should inject CSRF token
    await apiClient.post('/api/servers', { name: 'test' });
    expect(capturedHeaders?.get('x-csrf-token')).toBe('mock-csrf-token-xyz');
    expect(capturedHeaders?.get('origin')).toBeDefined();

    // DELETE request should inject CSRF token
    await apiClient.delete('/api/servers/123');
    expect(capturedHeaders?.get('x-csrf-token')).toBe('mock-csrf-token-xyz');
  });

  it('clears in-memory csrfToken and triggers 401 redirect on unauthorized response', async () => {
    setCsrfToken('active-token');
    expect(getCsrfToken()).toBe('active-token');

    // Mock window.location
    const originalLocation = window.location;
    delete (window as any).location;
    window.location = {
      ...originalLocation,
      pathname: '/servers',
      search: '?tab=tools',
      href: 'http://localhost:3000/servers?tab=tools',
    } as any;

    const mockResponse = {
      ok: false,
      status: 401,
      headers: new Headers({ 'x-request-id': 'req-unauth-401' }),
      json: async () => ({ message: 'Session expired' }),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await expect(apiFetch('/api/servers')).rejects.toThrowError(ApiError);

    // Assert CSRF token cleared from memory
    expect(getCsrfToken()).toBeNull();

    // Assert redirect returnTo location set
    expect(window.location.href).toBe('/login?returnTo=%2Fservers%3Ftab%3Dtools');

    window.location = originalLocation;
  });
});
