export type Role = 'admin' | 'member';

export type AuthVia = 'apikey' | 'session';

export type PrincipalSource = 'mcp' | 'chat';

export interface Principal {
  userId: string;
  role: Role;
  via: AuthVia;
  keyId?: string;
  source: PrincipalSource;
}

export type UpstreamServerState = 'connected' | 'unreachable' | 'disabled';

export type CircuitBreakerPhase = 'closed' | 'open' | 'half_open';

export type AuditOutcome =
  | 'success'
  | 'error'
  | 'timeout'
  | 'denied'
  | 'unreachable'
  | 'rate_limited'
  | 'invalid';

export interface AuditRecord {
  id?: string;
  requestId: string;
  userId: string;
  role: Role;
  source: PrincipalSource;
  serverSlug: string;
  toolName: string;
  exposedName: string;
  outcome: AuditOutcome;
  durationMs: number;
  statusCode?: number;
  errorCode?: string;
  timestamp: string;
}
