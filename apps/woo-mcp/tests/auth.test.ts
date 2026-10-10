import { describe, it, expect } from 'vitest';
import { verifyBearerToken } from '../src/auth.js';

describe('verifyBearerToken', () => {
  const validToken = 'super-secret-mcp-bearer-token-12345';

  it('accepts correct bearer token', () => {
    expect(verifyBearerToken(`Bearer ${validToken}`, validToken)).toBe(true);
  });

  it('accepts case-insensitive Bearer prefix', () => {
    expect(verifyBearerToken(`bearer ${validToken}`, validToken)).toBe(true);
  });

  it('rejects undefined or empty header', () => {
    expect(verifyBearerToken(undefined, validToken)).toBe(false);
    expect(verifyBearerToken('', validToken)).toBe(false);
  });

  it('rejects incorrect token with same length', () => {
    const wrongToken = 'super-secret-mcp-bearer-token-99999';
    expect(verifyBearerToken(`Bearer ${wrongToken}`, validToken)).toBe(false);
  });

  it('rejects token with different length', () => {
    expect(verifyBearerToken('Bearer short', validToken)).toBe(false);
    expect(verifyBearerToken(`Bearer ${validToken}-extra`, validToken)).toBe(false);
  });

  it('rejects invalid header format without Bearer prefix', () => {
    expect(verifyBearerToken(validToken, validToken)).toBe(false);
    expect(verifyBearerToken(`Basic ${validToken}`, validToken)).toBe(false);
    expect(verifyBearerToken('Bearer', validToken)).toBe(false);
  });
});
