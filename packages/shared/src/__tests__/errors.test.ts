import { describe, expect, it } from 'vitest';
import {
  CONDUIT_ERROR_CODES,
  ConduitError,
  HTTP_STATUS_BY_ERROR_CODE,
  formatGatewayErrorMessage,
} from '../errors.js';

describe('Error Handling Taxonomy', () => {
  it('should include all standard error codes from ERROR_HANDLING.md', () => {
    expect(CONDUIT_ERROR_CODES).toContain('auth_missing');
    expect(CONDUIT_ERROR_CODES).toContain('auth_invalid');
    expect(CONDUIT_ERROR_CODES).toContain('tool_unknown');
    expect(CONDUIT_ERROR_CODES).toContain('upstream_unreachable');
    expect(CONDUIT_ERROR_CODES).toContain('circuit_open');
    expect(CONDUIT_ERROR_CODES).toContain('upstream_timeout');
    expect(CONDUIT_ERROR_CODES).toContain('result_too_large');
    expect(CONDUIT_ERROR_CODES).toContain('ssrf_blocked');
  });

  it('should instantiate ConduitError with default HTTP status code', () => {
    const error = new ConduitError({
      code: 'validation_failed',
      message: 'Invalid input arguments',
      requestId: 'req-12345',
      fieldErrors: { sku: ['SKU cannot be empty'] },
    });

    expect(error.code).toBe('validation_failed');
    expect(error.statusCode).toBe(HTTP_STATUS_BY_ERROR_CODE['validation_failed']);
    expect(error.statusCode).toBe(422);
    expect(error.requestId).toBe('req-12345');
    expect(error.fieldErrors).toEqual({ sku: ['SKU cannot be empty'] });

    const json = error.toJSON();
    expect(json.code).toBe('validation_failed');
    expect(json.requestId).toBe('req-12345');
  });

  it('should format user/model-facing gateway error message correctly', () => {
    const formatted = formatGatewayErrorMessage(
      'upstream_unreachable',
      'woo',
      'connection refused',
    );
    expect(formatted).toBe(
      '[gateway:upstream_unreachable] The "woo" server encountered an issue: connection refused',
    );
  });
});
