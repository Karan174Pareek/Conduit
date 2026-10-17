import dns from 'node:dns/promises';
import { ConduitError } from '@conduit/shared';

export interface UrlPolicyResult {
  valid: boolean;
  reason?: string;
  resolvedIp?: string;
}

export interface UrlPolicy {
  validate(urlStr: string): Promise<UrlPolicyResult>;
}

/**
 * Checks if a string is a numeric decimal, octal (0177...) or hex (0x7f...) integer
 */
function parseNumericPart(part: string): number | null {
  const trimmed = part.trim();
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const val = parseInt(trimmed, 16);
    return isNaN(val) ? null : val;
  }
  if (/^0[0-7]+$/.test(trimmed)) {
    const val = parseInt(trimmed, 8);
    return isNaN(val) ? null : val;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    return isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Parse an IPv4 address string supporting dotted decimal, octal, hex, and single 32-bit integer
 */
export function parseIPv4(ipStr: string): bigint | null {
  const trimmed = ipStr.trim();
  // Check if it's a single 32-bit integer (decimal, hex, or octal)
  const singleNum = parseNumericPart(trimmed);
  if (singleNum !== null && !trimmed.includes('.')) {
    if (singleNum >= 0 && singleNum <= 0xffffffff) {
      return BigInt(singleNum);
    }
    return null;
  }

  const parts = trimmed.split('.');
  if (parts.length === 0 || parts.length > 4) {
    return null;
  }

  const nums: number[] = [];
  for (const part of parts) {
    const n = parseNumericPart(part);
    if (n === null || n < 0) return null;
    nums.push(n);
  }

  if (nums.length === 4) {
    if (nums.some((n) => n > 255)) return null;
    return BigInt(((nums[0]! << 24) | (nums[1]! << 16) | (nums[2]! << 8) | nums[3]!) >>> 0);
  } else if (nums.length === 3) {
    // a.b.c -> c is 16-bit
    if (nums[0]! > 255 || nums[1]! > 255 || nums[2]! > 65535) return null;
    return BigInt(((nums[0]! << 24) | (nums[1]! << 16) | nums[2]!) >>> 0);
  } else if (nums.length === 2) {
    // a.b -> b is 24-bit
    if (nums[0]! > 255 || nums[1]! > 16777215) return null;
    return BigInt(((nums[0]! << 24) | nums[1]!) >>> 0);
  } else if (nums.length === 1) {
    if (nums[0]! > 0xffffffff) return null;
    return BigInt(nums[0]! >>> 0);
  }
  return null;
}

/**
 * Normalizes an IPv6 address (stripping brackets) and parses it to a 128-bit BigInt
 */
export function parseIPv6(ipStr: string): bigint | null {
  let cleaned = ipStr.trim();
  if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
    cleaned = cleaned.slice(1, -1);
  }

  // Check for IPv4-mapped IPv6 like ::ffff:127.0.0.1 or ::ffff:7f00:1
  const lastColon = cleaned.lastIndexOf(':');
  if (lastColon !== -1) {
    const potentialIpv4 = cleaned.slice(lastColon + 1);
    if (potentialIpv4.includes('.')) {
      const v4Val = parseIPv4(potentialIpv4);
      if (v4Val === null) return null;
      const prefix = cleaned.slice(0, lastColon);
      if (prefix === '::ffff' || prefix === '0:0:0:0:0:ffff' || prefix === '::') {
        // Mapped address: 0x00000000000000000000ffff...
        const prefixVal = prefix === '::' ? 0n : 0xffffn;
        return (prefixVal << 32n) | v4Val;
      }
    }
  }

  // Standard IPv6 parsing
  const parts = cleaned.split('::');
  if (parts.length > 2) {
    return null; // More than one :: is invalid
  }

  const headParts: string[] = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const tailParts: string[] = parts.length === 2 && parts[1] ? parts[1].split(':').filter(Boolean) : [];

  const totalGroups = headParts.length + tailParts.length;
  if (parts.length === 1 && totalGroups !== 8) {
    return null;
  }
  if (parts.length === 2 && totalGroups > 7) {
    return null;
  }

  const missingGroups = parts.length === 2 ? 8 - totalGroups : 0;
  const fullGroups: number[] = [];

  for (const part of headParts) {
    const val = parseInt(part, 16);
    if (isNaN(val) || val < 0 || val > 0xffff) return null;
    fullGroups.push(val);
  }
  for (let i = 0; i < missingGroups; i++) {
    fullGroups.push(0);
  }
  for (const part of tailParts) {
    const val = parseInt(part, 16);
    if (isNaN(val) || val < 0 || val > 0xffff) return null;
    fullGroups.push(val);
  }

  if (fullGroups.length !== 8) return null;

  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result = (result << 16n) | BigInt(fullGroups[i]!);
  }
  return result;
}

/**
 * Checks whether an IP (v4 or v6) is private, loopback, link-local, multicast, or reserved.
 */
export function isPrivateOrRestrictedIp(ipStr: string): boolean {
  // Try IPv4 first
  const v4 = parseIPv4(ipStr);
  if (v4 !== null) {
    const n = Number(v4);
    const b0 = (n >>> 24) & 0xff;
    const b1 = (n >>> 16) & 0xff;
    const b2 = (n >>> 8) & 0xff;

    // 0.0.0.0/8 (unspecified)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (RFC 1918 private)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (RFC 1918 private)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (RFC 1918 private)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (link-local, cloud metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (CGNAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 192.0.2.0/24 (TEST-NET-1)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    // 198.51.100.0/24 (TEST-NET-2)
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3)
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;
    // 224.0.0.0/4 (multicast)
    if (b0 >= 224 && b0 <= 239) return true;
    // 240.0.0.0/4 (reserved) & 255.255.255.255 (broadcast)
    if (b0 >= 240) return true;

    return false;
  }

  // Try IPv6
  const v6 = parseIPv6(ipStr);
  if (v6 !== null) {
    // :: (unspecified)
    if (v6 === 0n) return true;
    // ::1 (loopback)
    if (v6 === 1n) return true;

    // Check if IPv4-mapped IPv6 (::ffff:x.x.x.x) or IPv4-compatible (::x.x.x.x)
    const upper96 = v6 >> 32n;
    if (upper96 === 0xffffn || upper96 === 0n) {
      const lower32 = Number(v6 & 0xffffffffn);
      const mappedV4Str = `${(lower32 >>> 24) & 0xff}.${(lower32 >>> 16) & 0xff}.${(lower32 >>> 8) & 0xff}.${lower32 & 0xff}`;
      return isPrivateOrRestrictedIp(mappedV4Str);
    }

    // fe80::/10 (link-local)
    // 0xfe80... to 0xfebf... -> top 10 bits match 0xfe80 (1111 1110 10)
    const top10 = v6 >> 118n;
    if (top10 === 0x3fan) return true;

    // fc00::/7 (unique local address / ULA - fc00:: to fdff::)
    // top 7 bits match 0xfc (1111 110)
    const top7 = v6 >> 121n;
    if (top7 === 0x7en) return true;

    // ff00::/8 (multicast)
    // top 8 bits match 0xff
    const top8 = v6 >> 120n;
    if (top8 === 0xffn) return true;

    // 2001:db8::/32 (documentation)
    const top32 = v6 >> 96n;
    if (top32 === 0x20010db8n) return true;

    return false;
  }

  // If not parseable as IPv4 or IPv6, treat as not an IP literal
  return false;
}

export function getAllowedHosts(): Set<string> {
  const defaultHosts =
    'store-woocommerce-store-woo-mcp.store-default.svc.cluster.local,notes-mcp.conduit-system.svc.cluster.local,utils-mcp.conduit-system.svc.cluster.local';
  const raw = process.env.SSRF_ALLOWED_HOSTS
    ? `${defaultHosts},${process.env.SSRF_ALLOWED_HOSTS}`
    : process.env.NODE_ENV === 'test'
      ? `${defaultHosts},127.0.0.1,localhost`
      : defaultHosts;
  const set = new Set<string>();
  for (const h of raw.split(',')) {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) {
      set.add(trimmed);
    }
  }
  return set;
}

export class FullSsrfUrlPolicy implements UrlPolicy {
  constructor(private readonly explicitAllowedHosts?: Set<string>) {}

  private getAllowed(): Set<string> {
    return this.explicitAllowedHosts ?? getAllowedHosts();
  }

  async validate(urlStr: string): Promise<UrlPolicyResult> {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { valid: false, reason: 'Invalid URL format' };
    }

    // 1. Protocol check
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'URL scheme must be http or https' };
    }

    // In production, https required unless host is allowlisted
    const hostname = parsed.hostname.toLowerCase();
    const isAllowlisted = this.getAllowed().has(hostname);

    if (process.env.NODE_ENV === 'production' && parsed.protocol === 'http:' && !isAllowlisted) {
      return { valid: false, reason: 'HTTPS is required in production for external servers' };
    }

    // 2. Embedded credentials check
    if (parsed.username || parsed.password) {
      return { valid: false, reason: 'Embedded credentials (username/password) are strictly disallowed in server URLs' };
    }

    // 3. IP Literal and Host check (including octal, decimal, hex, mapped IPv6)
    if (hostname.toLowerCase() === 'localhost') {
      if (!isAllowlisted) {
        return { valid: false, reason: 'SSRF blocked: localhost is prohibited' };
      }
    }

    const isLiteralV4 = parseIPv4(hostname);
    const isLiteralV6 = parseIPv6(hostname);

    if (isLiteralV4 !== null || isLiteralV6 !== null) {
      if (!isAllowlisted && isPrivateOrRestrictedIp(hostname)) {
        return { valid: false, reason: `SSRF blocked: IP literal ${hostname} resolves to prohibited private/restricted range` };
      }
    }

    // 4. Port check
    const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80;
    if (isAllowlisted) {
      // In test environment, ephemeral ports are permitted for in-process test servers
      const isTestEnv = process.env.NODE_ENV === 'test';
      const isAllowedPort =
        port === 80 ||
        port === 443 ||
        (port >= 3000 && port <= 3999) ||
        (isTestEnv && (hostname === '127.0.0.1' || hostname === 'localhost'));
      if (!isAllowedPort) {
        return { valid: false, reason: `Port ${port} is not permitted for in-cluster servers (allowed: 80, 443, 3000-3999)` };
      }
    } else {
      // Standard public ports only
      if (port !== 80 && port !== 443) {
        return { valid: false, reason: `Port ${port} is not permitted (only standard ports 80 and 443 are allowed)` };
      }
    }

    if (isLiteralV4 !== null || isLiteralV6 !== null) {
      return { valid: true };
    }

    // If allowlisted host, skip DNS check of private range
    if (isAllowlisted) {
      return { valid: true };
    }

    // 5. DNS resolution check
    try {
      const records = await dns.lookup(hostname, { all: true });
      if (!records || records.length === 0) {
        return { valid: false, reason: `DNS lookup failed for host ${hostname}` };
      }

      for (const rec of records) {
        if (isPrivateOrRestrictedIp(rec.address)) {
          return {
            valid: false,
            reason: `SSRF blocked: host ${hostname} resolved to prohibited private IP ${rec.address}`,
          };
        }
      }

      return { valid: true, resolvedIp: records[0]?.address };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, reason: `DNS lookup error: ${msg}` };
    }
  }
}

export const defaultUrlPolicy = new FullSsrfUrlPolicy();

export async function assertValidServerUrl(
  urlStr: string,
  policy: UrlPolicy = defaultUrlPolicy,
): Promise<void> {
  const result = await policy.validate(urlStr);
  if (!result.valid) {
    throw new ConduitError({
      code: 'validation_failed',
      message: result.reason ?? 'URL validation failed',
      statusCode: 422,
    });
  }
}
