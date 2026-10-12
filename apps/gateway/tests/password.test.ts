import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, verifyDummy } from '../src/services/password.js';

describe('Password Service (Argon2id)', () => {
  it('hashes and successfully verifies a password', async () => {
    const raw = 'mySuperSecretPassword123!';
    const hash = await hashPassword(raw);

    expect(hash).toContain('$argon2id$');

    const isValid = await verifyPassword(hash, raw);
    expect(isValid).toBe(true);

    const isInvalid = await verifyPassword(hash, 'wrongPassword123!');
    expect(isInvalid).toBe(false);
  });

  it('runs dummy verification returning false', async () => {
    const result = await verifyDummy('anyPasswordAttempt');
    expect(result).toBe(false);
  });
});
