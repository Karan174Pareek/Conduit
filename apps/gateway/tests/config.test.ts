import { describe, it, expect } from 'vitest';
import { configSchema, parseEncryptionKeys } from '../src/config.js';

describe('Gateway Config Validation', () => {
  const validBaseEnv = {
    PORT: '3000',
    HOST: '0.0.0.0',
    MONGO_URI: 'mongodb://conduit:pass@localhost:27017/conduit?authSource=conduit',
    SESSION_SECRET: '0'.repeat(64),
    API_KEY_PEPPER: '0'.repeat(64),
    CREDENTIAL_ENC_KEYS: 'k1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', // 32-byte base64
    BOOTSTRAP_ADMIN_EMAIL: 'admin@conduit.localhost',
    BOOTSTRAP_ADMIN_PASSWORD: 'secureAdminPassword123!',
    PUBLIC_DASHBOARD_URL: 'http://dashboard.localhost',
    PUBLIC_GATEWAY_URL: 'http://gateway.localhost',
    ALLOWED_ORIGINS: 'http://dashboard.localhost',
    LOG_LEVEL: 'info',
  };

  it('validates a correct configuration', () => {
    const result = configSchema.safeParse(validBaseEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3000);
      expect(result.data.BOOTSTRAP_ADMIN_EMAIL).toBe('admin@conduit.localhost');
    }
  });

  it('rejects missing MONGO_URI', () => {
    const env = { ...validBaseEnv, MONGO_URI: '' };
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects short SESSION_SECRET', () => {
    const env = { ...validBaseEnv, SESSION_SECRET: 'too-short' };
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects short API_KEY_PEPPER', () => {
    const env = { ...validBaseEnv, API_KEY_PEPPER: 'too-short' };
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it('rejects invalid CREDENTIAL_ENC_KEYS format or key length', () => {
    const envBadFormat = { ...validBaseEnv, CREDENTIAL_ENC_KEYS: 'invalid-no-colon' };
    expect(configSchema.safeParse(envBadFormat).success).toBe(false);

    const envBadLength = { ...validBaseEnv, CREDENTIAL_ENC_KEYS: 'k1:c2hvcnQ=' }; // "short" is not 32 bytes
    expect(configSchema.safeParse(envBadLength).success).toBe(false);
  });

  it('parses encryption keys correctly', () => {
    const keys = parseEncryptionKeys(
      'k1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=,k2:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]?.kid).toBe('k1');
    expect(keys[0]?.keyBuffer.length).toBe(32);
    expect(keys[1]?.kid).toBe('k2');
    expect(keys[1]?.keyBuffer.length).toBe(32);
  });
});
