import { MongoClient } from 'mongodb';
import { CredentialCrypto } from './crypto.js';
import { parseEncryptionKeys } from '../config.js';
import type { McpServerDocument, AdminEventDocument, SystemStateDocument } from '../db/types.js';

export interface RotateCredentialsResult {
  totalScanned: number;
  rotatedCount: number;
  activeKid: string;
}

export async function rotateCredentials(
  mongoUri: string,
  credentialEncKeys: string,
): Promise<RotateCredentialsResult> {
  const keys = parseEncryptionKeys(credentialEncKeys);
  const crypto = new CredentialCrypto(keys);
  const activeKid = crypto.getActiveKid();

  const client = new MongoClient(mongoUri);
  await client.connect();

  try {
    const db = client.db();
    const serversCol = db.collection<McpServerDocument>('mcp_servers');

    const servers = await serversCol.find({ 'auth.ciphertext': { $exists: true, $ne: '' } }).toArray();

    let rotatedCount = 0;

    for (const server of servers) {
      if (server.auth.kid === activeKid || server.auth.type === 'none') {
        continue;
      }

      const serverId = server._id?.toString() ?? server.slug;
      const decrypted = crypto.decryptCredential(serverId, server.auth);

      const reEncrypted = crypto.encryptCredential(
        serverId,
        decrypted,
        server.auth.type,
        server.auth.headerName,
      );

      await serversCol.updateOne(
        { _id: server._id },
        {
          $set: {
            auth: {
              ...server.auth,
              ciphertext: reEncrypted.ciphertext,
              iv: reEncrypted.iv,
              tag: reEncrypted.tag,
              kid: reEncrypted.kid,
            },
          },
        },
      );

      rotatedCount++;
    }

    if (rotatedCount > 0) {
      const now = new Date();
      await db.collection<SystemStateDocument>('system_state').updateOne(
        {},
        { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
        { upsert: true },
      );

      await db.collection<AdminEventDocument>('admin_events').insertOne({
        ts: now,
        actorId: 'system',
        actorEmail: 'system@conduit.localhost',
        action: 'rotate_credentials',
        target: {
          type: 'system',
          id: 'mcp_servers',
          label: 'credential_rotation',
        },
        details: {
          rotatedCount,
          activeKid,
        },
      });
    }

    return {
      totalScanned: servers.length,
      rotatedCount,
      activeKid,
    };
  } finally {
    await client.close();
  }
}
