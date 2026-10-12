import { describe, it, expect } from 'vitest';
import { generateApiKeyParts, hashApiKey } from '../src/services/api-keys.js';

describe('API Keys Unit Tests', () => {
  const pepper = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('generates API key parts matching specification format', () => {
    const { prefix, secret, fullKey, last4 } = generateApiKeyParts();

    expect(prefix).toMatch(/^[0-9a-f]{8}$/);
    expect(fullKey).toMatch(/^mcpgw_[0-9a-f]{8}_[A-Za-z0-9_-]{43,44}$/);
    expect(last4).toBe(secret.slice(-4));
    expect(fullKey.startsWith(`mcpgw_${prefix}_`)).toBe(true);
  });

  it('hashes API key with HMAC-SHA256 and pepper deterministically', () => {
    const key = 'mcpgw_12345678_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    const hash1 = hashApiKey(pepper, key);
    const hash2 = hashApiKey(pepper, key);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    const hashDifferentPepper = hashApiKey('different_pepper_0123456789abcdef0123456789abcdef', key);
    expect(hash1).not.toBe(hashDifferentPepper);
  });
});
