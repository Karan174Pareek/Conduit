import { describe, expect, it } from 'vitest';
import {
  EXPOSED_TOOL_MAX_LENGTH,
  formatExposedToolName,
  parseExposedToolName,
  validateServerSlug,
} from '../naming.js';
import { exposedToolNameSchema, principalSchema, serverSlugSchema } from '../schemas.js';

describe('Server & Tool Naming Conventions', () => {
  it('should validate server slugs strictly', () => {
    expect(validateServerSlug('woo')).toBe(true);
    expect(validateServerSlug('notes-mcp')).toBe(true);
    expect(validateServerSlug('store-123')).toBe(true);

    // Invalid slugs
    expect(validateServerSlug('123store')).toBe(false); // must start with letter
    expect(validateServerSlug('woo__store')).toBe(false); // double underscore disallowed
    expect(validateServerSlug('WOO')).toBe(false); // must be lowercase
    expect(validateServerSlug('a')).toBe(false); // min length 2
    expect(validateServerSlug('a'.repeat(32))).toBe(false); // max length 31
  });

  it('should format normal exposed tool names', () => {
    const exposed = formatExposedToolName('woo', 'list_orders');
    expect(exposed).toBe('woo__list_orders');
    expect(exposed.length).toBeLessThanOrEqual(EXPOSED_TOOL_MAX_LENGTH);
  });

  it('should truncate and hash tool names exceeding 64 characters deterministically', () => {
    const longTool = 'a_very_long_tool_name_that_exceeds_the_standard_mcp_client_limit_of_64_characters';
    const exposed = formatExposedToolName('myserver', longTool);

    expect(exposed.length).toBe(EXPOSED_TOOL_MAX_LENGTH);
    expect(exposed.startsWith('myserver__')).toBe(true);

    // Deterministic: second run produces identical result
    const exposedSecond = formatExposedToolName('myserver', longTool);
    expect(exposedSecond).toBe(exposed);

    // Ensure it matches the parse function
    const parsed = parseExposedToolName(exposed);
    expect(parsed).not.toBeNull();
    expect(parsed?.slug).toBe('myserver');
  });

  it('should parse valid exposed names and reject invalid ones', () => {
    const valid = parseExposedToolName('notes__search_items');
    expect(valid).toEqual({ slug: 'notes', toolPart: 'search_items' });

    expect(parseExposedToolName('invalidname')).toBeNull();
    expect(parseExposedToolName('__tool')).toBeNull();
  });

  it('should validate schemas correctly', () => {
    expect(serverSlugSchema.safeParse('woo').success).toBe(true);
    expect(serverSlugSchema.safeParse('Woo').success).toBe(false);

    expect(exposedToolNameSchema.safeParse('woo__list_products').success).toBe(true);
    expect(exposedToolNameSchema.safeParse('no_prefix_tool').success).toBe(false);

    const validPrincipal = {
      userId: 'usr_1',
      role: 'admin',
      via: 'apikey',
      keyId: 'key_1',
      source: 'mcp',
    };
    expect(principalSchema.safeParse(validPrincipal).success).toBe(true);

    const invalidPrincipal = {
      userId: 'usr_1',
      role: 'superadmin', // invalid role
      via: 'apikey',
      source: 'mcp',
    };
    expect(principalSchema.safeParse(invalidPrincipal).success).toBe(false);
  });
});
