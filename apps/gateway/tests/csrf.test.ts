import { describe, it, expect } from 'vitest';
import { verifyOrigin } from '../src/middleware/csrf.js';
import type { Config } from '../src/config.js';

describe('CSRF Origin Verification', () => {
  const mockConfig: Config = {
    PORT: 3000,
    HOST: '0.0.0.0',
    MONGO_URI: 'mongodb://localhost:27017/conduit',
    SESSION_SECRET: '0'.repeat(64),
    API_KEY_PEPPER: '0'.repeat(64),
    CREDENTIAL_ENC_KEYS: 'k1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@conduit.localhost',
    BOOTSTRAP_ADMIN_PASSWORD: 'password123!',
    PUBLIC_DASHBOARD_URL: 'http://dashboard.localhost',
    PUBLIC_GATEWAY_URL: 'http://gateway.localhost',
    ALLOWED_ORIGINS: 'http://dashboard.localhost,http://app.localhost:8080',
    LOG_LEVEL: 'info',
    ENABLE_DEBUG_ROUTES: false,
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash',
  };

  it('allows matching origins', () => {
    const req1: any = { headers: { origin: 'http://dashboard.localhost' } };
    expect(verifyOrigin(req1, mockConfig)).toBe(true);

    const req2: any = { headers: { origin: 'http://app.localhost:8080' } };
    expect(verifyOrigin(req2, mockConfig)).toBe(true);
  });

  it('rejects disallowed origins', () => {
    const req1: any = { headers: { origin: 'http://evil.com' } };
    expect(verifyOrigin(req1, mockConfig)).toBe(false);

    const req2: any = { headers: { origin: 'http://dashboard.localhost.evil.com' } };
    expect(verifyOrigin(req2, mockConfig)).toBe(false);
  });
});
