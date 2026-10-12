import { describe, expect, it } from 'vitest';
import { CredentialCrypto } from '../src/registry/crypto.js';
import { EncryptionKey } from '../src/config.js';

describe('CredentialCrypto (AES-256-GCM)', () => {
  const key1: EncryptionKey = {
    kid: 'k1',
    keyBuffer: Buffer.from('0123456789abcdef0123456789abcdef', 'utf-8'), // 32 bytes
  };
  const key2: EncryptionKey = {
    kid: 'k2',
    keyBuffer: Buffer.from('fedcba9876543210fedcba9876543210', 'utf-8'), // 32 bytes
  };

  it('performs successful encrypt/decrypt roundtrip', () => {
    const crypto = new CredentialCrypto([key1]);
    const serverId = 'srv_123';
    const secret = 'my-super-secret-mcp-upstream-token-value';

    const encrypted = crypto.encryptCredential(serverId, secret, 'bearer');
    expect(encrypted.type).toBe('bearer');
    expect(encrypted.kid).toBe('k1');
    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();

    const decrypted = crypto.decryptCredential(serverId, encrypted);
    expect(decrypted).toBe(secret);
  });

  it('fails decryption when AAD (serverId) does not match', () => {
    const crypto = new CredentialCrypto([key1]);
    const serverId = 'srv_original';
    const secret = 'secret-token';

    const encrypted = crypto.encryptCredential(serverId, secret, 'bearer');

    expect(() => {
      crypto.decryptCredential('srv_attacker_altered', encrypted);
    }).toThrow();

    // Verify decryptCredential has exactly 2 parameters (serverId and auth) with no fallback AAD parameter
    expect(crypto.decryptCredential.length).toBe(2);
  });

  it('fails decryption when ciphertext is tampered', () => {
    const crypto = new CredentialCrypto([key1]);
    const serverId = 'srv_123';
    const secret = 'secret-token';

    const encrypted = crypto.encryptCredential(serverId, secret, 'bearer');

    // Tamper ciphertext
    const rawCipher = Buffer.from(encrypted.ciphertext!, 'base64');
    rawCipher[0] = (rawCipher[0]! ^ 0xff);
    const tampered = { ...encrypted, ciphertext: rawCipher.toString('base64') };

    expect(() => {
      crypto.decryptCredential(serverId, tampered);
    }).toThrow();
  });

  it('supports key rotation: old kid still decrypts when new active key is added first', () => {
    // Initially encrypted with key1
    const initialCrypto = new CredentialCrypto([key1]);
    const serverId = 'srv_123';
    const secret = 'secret-token';

    const encryptedWithKey1 = initialCrypto.encryptCredential(serverId, secret, 'bearer');
    expect(encryptedWithKey1.kid).toBe('k1');

    // Key rotated: key2 added first in the list (new active key), key1 retained
    const rotatedCrypto = new CredentialCrypto([key2, key1]);

    // Old credential encrypted with key1 still decrypts cleanly
    const decryptedOld = rotatedCrypto.decryptCredential(serverId, encryptedWithKey1);
    expect(decryptedOld).toBe(secret);

    // New credentials are encrypted with active key2
    const encryptedWithKey2 = rotatedCrypto.encryptCredential(serverId, secret, 'bearer');
    expect(encryptedWithKey2.kid).toBe('k2');
    const decryptedNew = rotatedCrypto.decryptCredential(serverId, encryptedWithKey2);
    expect(decryptedNew).toBe(secret);
  });
});
