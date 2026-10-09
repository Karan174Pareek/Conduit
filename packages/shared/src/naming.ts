import { createHash } from 'node:crypto';

export const SERVER_SLUG_REGEX = /^[a-z][a-z0-9-]{1,30}$/;
export const EXPOSED_TOOL_MAX_LENGTH = 64;

/**
 * Validates a server slug according to the Conduit convention:
 * 2-31 characters, lowercase alphanumeric and hyphens, starting with a letter.
 * Slugs cannot contain double underscores.
 */
export function validateServerSlug(slug: string): boolean {
  if (!SERVER_SLUG_REGEX.test(slug)) {
    return false;
  }
  if (slug.includes('__')) {
    return false;
  }
  return true;
}

/**
 * Generates a 6-character hex hash from the original tool name.
 */
export function computeToolHash(toolName: string): string {
  return createHash('sha256').update(toolName).digest('hex').slice(0, 6);
}

/**
 * Formats an exposed tool name according to ARCHITECTURE.md §5.4:
 * `<slug>__<toolName>`
 * If total length exceeds 64 chars:
 * Truncates the tool part and appends `_` + 6 hex chars of SHA-256(originalToolName)
 * ensuring total length <= 64.
 */
export function formatExposedToolName(serverSlug: string, upstreamToolName: string): string {
  if (!validateServerSlug(serverSlug)) {
    throw new Error(
      `Invalid server slug "${serverSlug}". Must match ^[a-z][a-z0-9-]{1,30}$ and not contain '__'`,
    );
  }

  const standardName = `${serverSlug}__${upstreamToolName}`;
  if (standardName.length <= EXPOSED_TOOL_MAX_LENGTH) {
    return standardName;
  }

  const hash = computeToolHash(upstreamToolName);
  const suffix = `_${hash}`; // 7 chars
  const prefix = `${serverSlug}__`; // slug.length + 2 chars
  const availableLengthForTool = EXPOSED_TOOL_MAX_LENGTH - prefix.length - suffix.length;

  if (availableLengthForTool <= 0) {
    throw new Error(
      `Server slug "${serverSlug}" is too long to format tool name within ${EXPOSED_TOOL_MAX_LENGTH} characters.`,
    );
  }

  const truncatedTool = upstreamToolName.slice(0, availableLengthForTool);
  return `${prefix}${truncatedTool}${suffix}`;
}

/**
 * Parses an exposed tool name into its server slug and tool component.
 * Returns null if the format is invalid.
 */
export function parseExposedToolName(
  exposedName: string,
): { slug: string; toolPart: string } | null {
  const parts = exposedName.split('__');
  if (parts.length < 2) {
    return null;
  }
  const slug = parts[0];
  const toolPart = parts.slice(1).join('__');

  if (!slug || !toolPart || !validateServerSlug(slug)) {
    return null;
  }

  return { slug, toolPart };
}
