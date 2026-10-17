/**
 * Schema Sanitizer for Gemini Function Declarations.
 *
 * Drops `$schema`, `additionalProperties`, `$defs`, `definitions`.
 * Flattens simple `anyOf` / `oneOf` (e.g. nullable scalar types).
 * Caps recursion depth to prevent stack overflows or Gemini rejection (max depth 5).
 * Ensures top-level schema is a clean JSON Schema object.
 */

export function sanitizeToolSchema(
  rawSchema: unknown,
  maxDepth = 5,
  currentDepth = 0,
): Record<string, unknown> {
  if (currentDepth >= maxDepth || typeof rawSchema !== 'object' || rawSchema === null) {
    return { type: 'string' };
  }

  const schema = { ...(rawSchema as Record<string, unknown>) };

  // Drop unsupported keywords
  delete schema['$schema'];
  delete schema['additionalProperties'];
  delete schema['$defs'];
  delete schema['definitions'];

  // Flatten simple anyOf / oneOf (e.g. string or null)
  if (Array.isArray(schema['anyOf'])) {
    const nonNullVariant = schema['anyOf'].find(
      (v: any) => typeof v === 'object' && v !== null && v.type && v.type !== 'null',
    );
    if (nonNullVariant) {
      Object.assign(schema, sanitizeToolSchema(nonNullVariant, maxDepth, currentDepth + 1));
    }
    delete schema['anyOf'];
  }

  if (Array.isArray(schema['oneOf'])) {
    const nonNullVariant = schema['oneOf'].find(
      (v: any) => typeof v === 'object' && v !== null && v.type && v.type !== 'null',
    );
    if (nonNullVariant) {
      Object.assign(schema, sanitizeToolSchema(nonNullVariant, maxDepth, currentDepth + 1));
    }
    delete schema['oneOf'];
  }

  // Handle properties for object schemas
  if (schema['properties'] && typeof schema['properties'] === 'object' && schema['properties'] !== null) {
    const sanitizedProps: Record<string, unknown> = {};
    for (const [key, propVal] of Object.entries(schema['properties'] as Record<string, unknown>)) {
      sanitizedProps[key] = sanitizeToolSchema(propVal, maxDepth, currentDepth + 1);
    }
    schema['properties'] = sanitizedProps;
  }

  // Handle items for array schemas
  if (schema['items'] && typeof schema['items'] === 'object' && schema['items'] !== null) {
    schema['items'] = sanitizeToolSchema(schema['items'], maxDepth, currentDepth + 1);
  }

  // Top level fallback
  if (currentDepth === 0) {
    if (!schema['type']) {
      schema['type'] = 'object';
    }
    if (schema['type'] === 'object' && !schema['properties']) {
      schema['properties'] = {};
    }
  }

  return schema;
}
