import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { REDACTED_PATHS } from '../src/logger.js';

describe('Logger Sensitive Data Redaction', () => {
  it('redacts passwords, peppers, API keys, and auth headers from log outputs', () => {
    let capturedLogs = '';
    const destination = {
      write: (chunk: string) => {
        capturedLogs += chunk;
      },
    };

    const logger = pino(
      {
        level: 'info',
        redact: {
          paths: REDACTED_PATHS,
          censor: '[REDACTED]',
        },
      },
      destination as any,
    );

    const secretPassword = 'bootstrapAdminSecretPassword123!';
    const secretPepper = 'myUltraSecretPepperHexValue0123456789';
    const secretApiKey = ['mcpgw', '12345678', 'secretKeyPartGenerated1234567890'].join('_');
    const secretSession = 'superSecretSessionIdTokenValue987654';

    // Log various objects and formats
    logger.info({
      msg: 'Login attempt',
      password: secretPassword,
      req: {
        headers: {
          authorization: `Bearer ${secretApiKey}`,
          cookie: `session_id=${secretSession}`,
          'x-csrf-token': 'csrf-token-secret-value-12345',
        },
      },
      apiKey: secretApiKey,
      token: 'some_other_token',
    });

    logger.info({
      msg: 'User created',
      credential: {
        password: secretPassword,
        pepper: secretPepper,
      },
    });

    // Verify NONE of the plaintext secrets exist in captured output
    expect(capturedLogs).not.toContain(secretPassword);
    expect(capturedLogs).not.toContain(secretPepper);
    expect(capturedLogs).not.toContain(secretApiKey);
    expect(capturedLogs).not.toContain(secretSession);
    expect(capturedLogs).not.toContain('csrf-token-secret-value-12345');

    // Verify that [REDACTED] is present in the output
    expect(capturedLogs).toContain('[REDACTED]');
  });
});
