import crypto from 'node:crypto';

/**
 * Validates an Authorization header against an expected bearer token using
 * timing-safe constant-time comparison to prevent timing side-channel attacks.
 */
export function verifyBearerToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader) {
    return false;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer') {
    return false;
  }

  const token = parts[1] ?? '';
  const tokenBuffer = Buffer.from(token, 'utf-8');
  const expectedBuffer = Buffer.from(expectedToken, 'utf-8');

  if (tokenBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, expectedBuffer);
}
