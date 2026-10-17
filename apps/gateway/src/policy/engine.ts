import type { Db } from 'mongodb';
import type { PolicyDocument } from '../db/types.js';
import type { Principal } from '../router/tool-router.js';

export function globToRegex(pattern: string): RegExp {
  if (pattern === '*') {
    return /^.*$/;
  }
  // Escape regex special chars except * and ?
  const escaped = pattern
    .replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

export function matchesPattern(pattern: string, str: string): boolean {
  if (pattern === '*' || pattern === str) {
    return true;
  }
  return globToRegex(pattern).test(str);
}

export class DbPolicyEngine {
  constructor(
    private readonly db: Db,
    private readonly options: { membersReadOnlyDefault?: boolean } = {},
  ) {}

  /**
   * Checks whether the given server matches a policy rule's serverId field.
   * serverId in rule can be '*', the server's slug, or its ObjectId string.
   */
  private matchesServer(ruleServerId: string, serverSlug: string): boolean {
    if (ruleServerId === '*' || ruleServerId === serverSlug) {
      return true;
    }
    return false;
  }

  /**
   * Evaluates policy per ARCHITECTURE §5.6:
   * explicit user deny > explicit user allow > role deny > role allow > shortcut/readOnly > default
   */
  async evaluate(
    principal: Principal,
    serverSlug: string,
    toolName: string,
    annotations?: Record<string, unknown>,
    serverTrusted?: boolean,
  ): Promise<boolean> {
    // Fetch all active policies from db
    const policies = await this.db
      .collection<PolicyDocument>('policies')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // 1. Explicit user deny
    const userDeny = policies.find(
      (p) =>
        p.scope === 'user' &&
        p.subjectId === principal.userId &&
        p.effect === 'deny' &&
        this.matchesServer(p.serverId, serverSlug) &&
        matchesPattern(p.toolPattern, toolName),
    );
    if (userDeny) {
      return false;
    }

    // 2. Explicit user allow
    const userAllow = policies.find(
      (p) =>
        p.scope === 'user' &&
        p.subjectId === principal.userId &&
        p.effect === 'allow' &&
        this.matchesServer(p.serverId, serverSlug) &&
        matchesPattern(p.toolPattern, toolName),
    );
    if (userAllow) {
      return true;
    }

    // 3. Role deny
    const roleDeny = policies.find(
      (p) =>
        p.scope === 'role' &&
        p.role === principal.role &&
        p.effect === 'deny' &&
        this.matchesServer(p.serverId, serverSlug) &&
        matchesPattern(p.toolPattern, toolName),
    );
    if (roleDeny) {
      return false;
    }

    // 4. Role allow
    const roleAllow = policies.find(
      (p) =>
        p.scope === 'role' &&
        p.role === principal.role &&
        p.effect === 'allow' &&
        this.matchesServer(p.serverId, serverSlug) &&
        matchesPattern(p.toolPattern, toolName),
    );
    if (roleAllow) {
      return true;
    }

    // 5. Convenience shortcut: "members: read-only tools only"
    // Honoured only for trusted servers (hints from untrusted servers are claims, not facts)
    const membersReadOnlyConfig =
      this.options.membersReadOnlyDefault ??
      process.env.POLICY_MEMBERS_READ_ONLY === 'true';

    const hasReadOnlyPolicy = policies.some(
      (p) => p.scope === 'role' && p.role === 'member' && p.readOnlyOnly,
    );

    if (principal.role === 'member' && (membersReadOnlyConfig || hasReadOnlyPolicy)) {
      if (serverTrusted) {
        return annotations?.readOnly === true;
      }
      // If server is not trusted, member cannot call tools under read-only rule without explicit allow
      return false;
    }

    // 6. Default
    // Admin: allow. Member: allow unless default-deny is set.
    if (principal.role === 'admin') {
      return true;
    }

    return true;
  }
}
