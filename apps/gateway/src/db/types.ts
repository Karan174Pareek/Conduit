import { ObjectId } from 'mongodb';
import type { Role } from '@conduit/shared';

export interface UserDocument {
  _id: ObjectId;
  email: string;
  name?: string;
  role: Role;
  passwordHash: string;
  status?: 'invited' | 'active' | 'disabled';
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
  mustChangePassword?: boolean;
  disabled?: boolean;
  disabledAt?: Date | null;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDocument {
  _id?: ObjectId;
  tokenHash: string;
  userId: string;
  csrfToken: string;
  createdAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  expiresAt: Date;
}

export interface ApiKeyDocument {
  _id?: ObjectId;
  prefix: string;
  keyHash: string;
  last4: string;
  name: string;
  ownerId: string;
  createdAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

export interface McpServerDocument {
  _id?: ObjectId;
  slug: string;
  displayName: string;
  url: string;
  enabled: boolean;
  trusted: boolean;
  system: boolean;
  origin: 'seed' | 'admin' | 'provisioner';
  auth: {
    type: 'none' | 'bearer' | 'header';
    headerName?: string | null;
    ciphertext?: string;
    iv?: string;
    tag?: string;
    kid?: string;
  };
  callTimeoutMs: number;
  maxConcurrent: number;
  approveOnAdd: boolean;
  status: {
    state: 'connected' | 'unreachable' | 'disabled';
    reasonCode: string | null;
    reason: string | null;
    checkedAt: Date | null;
    lastSuccessAt: Date | null;
  };
  storeId?: string | null;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolCatalogDocument {
  _id?: ObjectId;
  serverId: string;
  name: string;
  exposedName: string;
  description: string;
  descriptionRaw: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  hash: string;
  approval: {
    status: 'approved' | 'pending' | 'changed';
    approvedHash?: string;
    approvedBy?: string;
    approvedAt?: Date;
  };
  firstSeenAt: Date;
  lastSeenAt: Date;
  removedAt: Date | null;
}

export interface AdminEventDocument {
  _id?: ObjectId;
  ts: Date;
  actorId: string;
  actorEmail: string;
  action: string;
  target: { type: string; id: string; label: string };
  details: Record<string, unknown>;
  requestId?: string;
  ip?: string;
}

export interface SystemStateDocument {
  _id: string;
  configVersion?: number;
  version?: number;
  updatedAt?: Date;
}

export interface ToolCallDocument {
  _id?: ObjectId;
  ts: Date;
  requestId: string;
  userId: string;
  userEmail: string;
  role: Role;
  via: 'apikey' | 'session';
  keyId?: string | null;
  source: 'mcp' | 'chat';
  conversationId?: string | null;
  serverId?: string;
  serverSlug: string;
  tool: string;
  exposedName: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'timeout' | 'denied' | 'unreachable' | 'rate_limited' | 'invalid' | 'quarantined';
  errorCode?: string | null;
  errorMessage?: string | null;
  argsSummary: string;
  argsHash: string;
  resultBytes?: number;
  upstreamIsError?: boolean;
}

export interface InviteDocument {
  _id?: ObjectId;
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface PolicyDocument {
  _id?: ObjectId;
  scope: 'role' | 'user';
  role?: Role;
  subjectId?: string;
  serverId: string;
  toolPattern: string;
  effect: 'allow' | 'deny';
  readOnlyOnly?: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}


export function toObjectId(id: string): ObjectId | null {
  if (ObjectId.isValid(id)) {
    return new ObjectId(id);
  }
  return null;
}
