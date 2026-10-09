export const CONDUIT_ERROR_CODES = [
  'auth_missing',
  'auth_invalid',
  'auth_revoked',
  'auth_expired',
  'user_disabled',
  'forbidden',
  'csrf_failed',
  'validation_failed',
  'tool_unknown',
  'rate_limited',
  'upstream_disabled',
  'upstream_unreachable',
  'circuit_open',
  'upstream_busy',
  'upstream_timeout',
  'upstream_auth_failed',
  'upstream_protocol_error',
  'upstream_tool_error',
  'result_too_large',
  'ssrf_blocked',
  'internal_error',
  'llm_unavailable',
  'llm_rate_limited',
  'llm_bad_request',
] as const;

export type ConduitErrorCode = (typeof CONDUIT_ERROR_CODES)[number];

export const HTTP_STATUS_BY_ERROR_CODE: Record<ConduitErrorCode, number> = {
  auth_missing: 401,
  auth_invalid: 401,
  auth_revoked: 401,
  auth_expired: 401,
  user_disabled: 401,
  forbidden: 403,
  csrf_failed: 403,
  validation_failed: 422,
  tool_unknown: 404,
  rate_limited: 429,
  upstream_disabled: 403,
  upstream_unreachable: 502,
  circuit_open: 503,
  upstream_busy: 503,
  upstream_timeout: 504,
  upstream_auth_failed: 502,
  upstream_protocol_error: 502,
  upstream_tool_error: 422,
  result_too_large: 413,
  ssrf_blocked: 422,
  internal_error: 500,
  llm_unavailable: 503,
  llm_rate_limited: 429,
  llm_bad_request: 400,
};

export interface ConduitErrorOptions {
  code: ConduitErrorCode;
  message: string;
  requestId?: string | undefined;
  statusCode?: number | undefined;
  fieldErrors?: Record<string, string[]> | undefined;
  cause?: unknown;
}

export interface ConduitErrorJSON {
  code: ConduitErrorCode;
  message: string;
  requestId?: string;
  statusCode: number;
  fieldErrors?: Record<string, string[]>;
}

export class ConduitError extends Error {
  readonly code: ConduitErrorCode;
  readonly requestId: string | undefined;
  readonly statusCode: number;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(options: ConduitErrorOptions) {
    super(options.message);
    this.name = 'ConduitError';
    this.code = options.code;
    this.requestId = options.requestId;
    this.statusCode = options.statusCode ?? HTTP_STATUS_BY_ERROR_CODE[options.code] ?? 500;
    this.fieldErrors = options.fieldErrors;
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  toJSON(): ConduitErrorJSON {
    const result: ConduitErrorJSON = {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
    };
    if (this.requestId !== undefined) {
      result.requestId = this.requestId;
    }
    if (this.fieldErrors !== undefined) {
      result.fieldErrors = this.fieldErrors;
    }
    return result;
  }
}

/**
 * Formats user/model facing tool error messages with the required prefix:
 * `[gateway:<code>] <message>` per ERROR_HANDLING.md section 1.
 */
export function formatGatewayErrorMessage(
  code: ConduitErrorCode,
  serverSlug: string,
  detail?: string,
): string {
  const baseMessage = detail
    ? `The "${serverSlug}" server encountered an issue: ${detail}`
    : `The "${serverSlug}" server encountered error "${code}". Other servers remain unaffected.`;
  return `[gateway:${code}] ${baseMessage}`;
}
