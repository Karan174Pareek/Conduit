import crypto from 'node:crypto';

const SENSITIVE_KEY_REGEX = /token|key|secret|password|auth|credit/i;

/**
 * Recursively redacts sensitive keys from an arguments object.
 */
export function redactSensitiveKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveKeys(item));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveKeys(val);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Creates a canonical, redacted 200-character summary and a SHA-256 hash
 * of the input arguments.
 */
export function processAuditArguments(args: Record<string, unknown> = {}): {
  argsSummary: string;
  argsHash: string;
} {
  const redacted = redactSensitiveKeys(args) as Record<string, unknown>;

  // Format key=value pairs up to 200 chars
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(redacted)) {
    let strVal = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (strVal.length > 50) {
      strVal = `${strVal.slice(0, 47)}...`;
    }
    pairs.push(`${k}=${strVal}`);
  }

  let summary = pairs.join(' ');
  if (summary.length > 200) {
    summary = `${summary.slice(0, 197)}...`;
  }

  const rawCanonical = JSON.stringify(args, Object.keys(args).sort());
  const argsHash = crypto.createHash('sha256').update(rawCanonical).digest('hex');

  return {
    argsSummary: summary,
    argsHash,
  };
}

/**
 * Sanitizes a CSV cell to prevent formula injection (CSV Injection / DDE).
 * If cell starts with '=', '+', '-', '@', '\t', or '\r', prepends a single quote "'".
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';

  let str = String(value);

  // Check for dangerous leading characters
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Escape double quotes
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}
