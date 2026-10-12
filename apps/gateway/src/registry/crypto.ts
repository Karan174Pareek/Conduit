import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EncryptionKey } from '../config.js';

export interface EncryptedAuthCredential {
  type: 'none' | 'bearer' | 'header';
  headerName?: string | null;
  ciphertext?: string;
  iv?: string;
  tag?: string;
  kid?: string;
}

export class CredentialCrypto {
  private readonly keysByKid = new Map<string, Buffer>();
  private readonly activeKey: EncryptionKey;

  constructor(keys: EncryptionKey[]) {
    if (!keys || keys.length === 0) {
      throw new Error('CredentialCrypto requires at least one encryption key in CREDENTIAL_ENC_KEYS');
    }
    const firstKey = keys[0];
    if (!firstKey) {
      throw new Error('Active encryption key cannot be undefined');
    }
    this.activeKey = firstKey;
    for (const k of keys) {
      this.keysByKid.set(k.kid, k.keyBuffer);
    }
  }

  /**
   * Encrypts an upstream credential using AES-256-GCM with a 12-byte random IV,
   * setting AAD to the serverId. Uses the active (first) key id.
   */
  encryptCredential(
    serverId: string,
    plaintext: string,
    authType: 'bearer' | 'header',
    headerName?: string | null,
  ): EncryptedAuthCredential {
    if (!plaintext) {
      return { type: authType, headerName: headerName ?? null };
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.activeKey.keyBuffer, iv);
    cipher.setAAD(Buffer.from(serverId, 'utf-8'));

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      type: authType,
      headerName: headerName ?? null,
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      kid: this.activeKey.kid,
    };
  }

  /**
   * Decrypts an upstream credential using AES-256-GCM.
   * Uses the kid attached to the credential record.
   * Verifies AAD = serverId and auth tag.
   */
  decryptCredential(serverId: string, auth: EncryptedAuthCredential): string {
    if (!auth || auth.type === 'none' || !auth.ciphertext || !auth.iv || !auth.tag || !auth.kid) {
      return '';
    }

    const keyBuffer = this.keysByKid.get(auth.kid);
    if (!keyBuffer) {
      throw new Error(`Unknown encryption key id (kid): "${auth.kid}". Key not found in CREDENTIAL_ENC_KEYS.`);
    }

    const iv = Buffer.from(auth.iv, 'base64');
    const tag = Buffer.from(auth.tag, 'base64');
    const ciphertext = Buffer.from(auth.ciphertext, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAAD(Buffer.from(serverId, 'utf-8'));
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf-8');
  }
}
