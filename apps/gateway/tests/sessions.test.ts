import { describe, it, expect } from 'vitest';
import {
  hashSessionToken,
  generateSessionToken,
  generateCsrfToken,
  IDLE_TIMEOUT_MS,
  ABSOLUTE_TIMEOUT_MS,
} from '../src/services/sessions.js';

describe('Sessions Unit Tests', () => {
  it('generates session and CSRF tokens in base64url format', () => {
    const sessionToken = generateSessionToken();
    const csrfToken = generateCsrfToken();

    expect(sessionToken).toHaveLength(43);
    expect(csrfToken).toHaveLength(43);
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(csrfToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes session token using SHA-256', () => {
    const token = 'my_test_session_token_12345';
    const hash1 = hashSessionToken(token);
    const hash2 = hashSessionToken(token);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('configures sliding 8h and absolute 7d timeout bounds', () => {
    expect(IDLE_TIMEOUT_MS).toBe(8 * 60 * 60 * 1000);
    expect(ABSOLUTE_TIMEOUT_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
