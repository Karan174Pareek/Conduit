import { describe, expect, it } from 'vitest';
import {
  canonicalJsonStringify,
  computeToolDefinitionHash,
  MAX_DESCRIPTION_LENGTH,
  sanitizeText,
  validateAndSanitizeSchema,
} from '../src/catalog/sanitizer.js';

describe('Catalog Sanitizer', () => {
  it('strips zero-width, bidi override, and non-printable control characters', () => {
    // \u200B = zero-width space, \u202E = right-to-left override, \u0007 = bell control char
    const dirty = 'Hello\u200B \u202EWorld\u0007! Standard newline:\nand tab:\tkept.';
    const clean = sanitizeText(dirty);

    expect(clean).toBe('Hello World! Standard newline:\nand tab:\tkept.');
  });

  it('caps description to MAX_DESCRIPTION_LENGTH characters', () => {
    const longText = 'a'.repeat(1500);
    const clean = sanitizeText(longText);

    expect(clean.length).toBe(MAX_DESCRIPTION_LENGTH);
    expect(clean).toBe('a'.repeat(MAX_DESCRIPTION_LENGTH));
  });

  it('validates schemas and rejects remote $ref', () => {
    const safeSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        localRef: { $ref: '#/definitions/LocalType' },
      },
    };
    expect(validateAndSanitizeSchema(safeSchema).valid).toBe(true);

    const maliciousSchemaHttp = {
      type: 'object',
      properties: {
        evil: { $ref: 'http://attacker.com/schema.json' },
      },
    };
    const resHttp = validateAndSanitizeSchema(maliciousSchemaHttp);
    expect(resHttp.valid).toBe(false);
    expect(resHttp.error).toContain('Remote schema references are disallowed');

    const maliciousSchemaHttps = {
      type: 'object',
      properties: {
        evil: { $ref: 'https://attacker.com/schema.json' },
      },
    };
    const resHttps = validateAndSanitizeSchema(maliciousSchemaHttps);
    expect(resHttps.valid).toBe(false);
    expect(resHttps.error).toContain('Remote schema references are disallowed');
  });

  it('rejects schemas exceeding maximum depth', () => {
    // Build nested schema exceeding depth 10
    let deeplyNested: any = { type: 'string' };
    for (let i = 0; i < 15; i++) {
      deeplyNested = { type: 'object', properties: { child: deeplyNested } };
    }

    const res = validateAndSanitizeSchema(deeplyNested);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Schema depth exceeds maximum allowed depth');
  });

  it('rejects schemas exceeding maximum size (64 KB)', () => {
    const largeObject: Record<string, string> = {};
    for (let i = 0; i < 2000; i++) {
      largeObject[`file_${i}`] = 'val_'.repeat(10);
    }
    const res = validateAndSanitizeSchema({ type: 'object', properties: largeObject });
    expect(res.valid).toBe(false);
    expect(res.error).toContain('Schema size exceeds maximum allowed size');
  });

  it('strips Unicode tag characters', () => {
    const withTags = 'Hello\uDB40\uDC01\uDB40\uDC20World';
    const clean = sanitizeText(withTags);
    expect(clean).toBe('HelloWorld');
  });
  it('computes deterministic canonical JSON hashes regardless of key insertion order', () => {
    const toolA = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { b: 2, a: 1 },
      annotations: { readOnly: true },
    };

    const toolB = {
      annotations: { readOnly: true },
      inputSchema: { a: 1, b: 2 },
      description: 'A test tool',
      name: 'test_tool',
    };

    const hashA = computeToolDefinitionHash(toolA);
    const hashB = computeToolDefinitionHash(toolB);

    expect(hashA).toBe(hashB);
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
