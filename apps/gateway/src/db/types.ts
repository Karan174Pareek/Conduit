import { ObjectId } from 'mongodb';
import type { Role } from '@conduit/shared';

export interface UserDocument {
  _id: ObjectId;
  email: string;
  role: Role;
  passwordHash: string;
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
  disabled?: boolean;
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

export function toObjectId(id: string): ObjectId | null {
  if (ObjectId.isValid(id)) {
    return new ObjectId(id);
  }
  return null;
}
