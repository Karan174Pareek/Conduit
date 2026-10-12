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

export function toObjectId(id: string): ObjectId | null {
  if (ObjectId.isValid(id)) {
    return new ObjectId(id);
  }
  return null;
}
