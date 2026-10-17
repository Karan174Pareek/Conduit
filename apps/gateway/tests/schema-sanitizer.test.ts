import { describe, it, expect } from 'vitest';
import { sanitizeToolSchema } from '../src/chat/schema-sanitizer.js';

describe('Schema Sanitizer for Gemini Function Declarations', () => {
  it('strips unsupported keywords ($schema, additionalProperties, $defs, definitions)', () => {
    const raw = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      $defs: {
        address: { type: 'string' },
      },
      definitions: {
        legacy: { type: 'number' },
      },
      properties: {
        name: { type: 'string', additionalProperties: false },
      },
      required: ['name'],
    };

    const sanitized = sanitizeToolSchema(raw);

    expect(sanitized['$schema']).toBeUndefined();
    expect(sanitized['additionalProperties']).toBeUndefined();
    expect(sanitized['$defs']).toBeUndefined();
    expect(sanitized['definitions']).toBeUndefined();
    expect((sanitized['properties'] as any)?.name?.additionalProperties).toBeUndefined();
    expect(sanitized['required']).toEqual(['name']);
  });

  it('flattens simple anyOf and oneOf constructs', () => {
    const raw = {
      type: 'object',
      properties: {
        description: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
        },
        priority: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
        },
      },
    };

    const sanitized = sanitizeToolSchema(raw);
    const props = sanitized['properties'] as any;

    expect(props.description.type).toBe('string');
    expect(props.description.anyOf).toBeUndefined();
    expect(props.priority.type).toBe('integer');
    expect(props.priority.oneOf).toBeUndefined();
  });

  it('caps recursion depth to 5', () => {
    const deeplyNested: any = {
      type: 'object',
      properties: {
        l1: {
          type: 'object',
          properties: {
            l2: {
              type: 'object',
              properties: {
                l3: {
                  type: 'object',
                  properties: {
                    l4: {
                      type: 'object',
                      properties: {
                        l5: {
                          type: 'object',
                          properties: {
                            l6: { type: 'string' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const sanitized = sanitizeToolSchema(deeplyNested);
    const l1 = (sanitized.properties as any).l1;
    const l2 = l1.properties.l2;
    const l3 = l2.properties.l3;
    const l4 = l3.properties.l4;
    const l5 = l4.properties.l5;

    // At depth 5, deep object is safely collapsed to scalar fallback
    expect(l5.type).toBe('string');
  });

  it('sanitizes real-world WooCommerce tool schemas', () => {
    const wooProductsCreateSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Product name' },
        type: { type: 'string', enum: ['simple', 'grouped', 'external', 'variable'] },
        regular_price: { type: 'string', description: 'Product regular price' },
        description: { type: 'string', description: 'Product description' },
        categories: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'integer' } },
            additionalProperties: false,
          },
        },
      },
      required: ['name'],
    };

    const sanitized = sanitizeToolSchema(wooProductsCreateSchema);

    expect(sanitized['$schema']).toBeUndefined();
    expect(sanitized['additionalProperties']).toBeUndefined();
    expect(sanitized['type']).toBe('object');
    expect((sanitized['properties'] as any).categories.type).toBe('array');
    expect((sanitized['properties'] as any).categories.items.additionalProperties).toBeUndefined();
    expect(sanitized['required']).toEqual(['name']);
  });
});
