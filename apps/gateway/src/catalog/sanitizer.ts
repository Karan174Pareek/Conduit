/* eslint-disable no-control-regex */
import { createHash } from 'node:crypto';

// Matches zero-width characters, bidi overrides, Unicode tags, and non-printable control characters except \n, \r, \t
const DANGEROUS_UNICODE_REGEX =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069]|[\uD83C][\uDF00-\uDFFF]|[\uDB40][\uDC00-\uDC7F]/g;

export const MAX_DESCRIPTION_LENGTH = 1000;
export const MAX_SCHEMA_DEPTH = 10;
export const MAX_SCHEMA_SIZE_BYTES = 64 * 1024; // 64 KB

export function sanitizeText(text: string): string {
  if (!text) return '';
  const cleaned = text.replace(DANGEROUS_UNICODE_REGEX, '');
  if (cleaned.length <= MAX_DESCRIPTION_LENGTH) {
    return cleaned;
  }
  return cleaned.slice(0, MAX_DESCRIPTION_LENGTH);
}

export function validateAndSanitizeSchema(
  schema: unknown,
  depth = 0,
): { valid: boolean; sanitizedSchema?: Record<string, unknown>; error?: string } {
  if (depth > MAX_SCHEMA_DEPTH) {
    return { valid: false, error: `Schema depth exceeds maximum allowed depth of ${MAX_SCHEMA_DEPTH}` };
  }

  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return { valid: false, error: 'Schema must be a valid JSON object' };
  }

  const rawJson = JSON.stringify(schema);
  if (Buffer.byteLength(rawJson, 'utf-8') > MAX_SCHEMA_SIZE_BYTES) {
    return { valid: false, error: `Schema size exceeds maximum allowed size of ${MAX_SCHEMA_SIZE_BYTES} bytes` };
  }

  // Recursive walk to check for remote $ref and depth
  function walk(node: unknown, currentDepth: number): string | null {
    if (currentDepth > MAX_SCHEMA_DEPTH) {
      return `Schema depth exceeds maximum allowed depth of ${MAX_SCHEMA_DEPTH}`;
    }
    if (typeof node !== 'object' || node === null) {
      return null;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        const err = walk(item, currentDepth + 1);
        if (err) return err;
      }
      return null;
    }

    const obj = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      if (key === '$ref' && typeof value === 'string') {
        if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('//')) {
          return `Remote schema references are disallowed: "${value}"`;
        }
      }
      const err = walk(value, currentDepth + 1);
      if (err) return err;
    }

    return null;
  }

  const walkError = walk(schema, depth);
  if (walkError) {
    return { valid: false, error: walkError };
  }

  return { valid: true, sanitizedSchema: schema as Record<string, unknown> };
}

/**
 * Deterministic JSON stringifier (canonical JSON: sorted keys).
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }

  const record = obj as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const entries = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Computes canonical SHA-256 hash of { name, description, inputSchema, annotations }.
 */
export function computeToolDefinitionHash(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}): string {
  const canonicalData = {
    annotations: tool.annotations ?? {},
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
  };

  const canonicalString = canonicalJsonStringify(canonicalData);
  return createHash('sha256').update(canonicalString, 'utf-8').digest('hex');
}
