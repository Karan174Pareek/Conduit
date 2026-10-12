import { ConduitError } from '@conduit/shared';

export interface UrlPolicyResult {
  valid: boolean;
  reason?: string;
}

export interface UrlPolicy {
  validate(urlStr: string): Promise<UrlPolicyResult>;
}

/**
 * Basic URL policy for Phase 3B.
 * Enforces http/https protocols and rejects embedded credentials.
 *
 * TODO (Phase 8): Implement full SSRF protection:
 * 1. Resolve DNS and block private / loopback / link-local / cloud-metadata IPs.
 * 2. Bypass check only for hosts in SSRF_ALLOWED_HOSTS (e.g. in-cluster Service DNS).
 * 3. Enforce custom dialer lookup to prevent DNS rebinding.
 */
export class DefaultUrlPolicy implements UrlPolicy {
  async validate(urlStr: string): Promise<UrlPolicyResult> {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      return { valid: false, reason: 'Invalid URL format' };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'URL scheme must be http or https' };
    }

    if (parsed.username || parsed.password) {
      return { valid: false, reason: 'Embedded credentials (username/password) are strictly disallowed in server URLs' };
    }

    return { valid: true };
  }
}

export async function assertValidServerUrl(urlStr: string, policy: UrlPolicy = new DefaultUrlPolicy()): Promise<void> {
  const result = await policy.validate(urlStr);
  if (!result.valid) {
    throw new ConduitError({
      code: 'validation_failed',
      message: result.reason ?? 'URL validation failed',
      statusCode: 422,
    });
  }
}
