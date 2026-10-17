#!/usr/bin/env node
import { rotateCredentials } from '../apps/gateway/src/registry/rotate.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/conduit';
const encKeys = process.env.CREDENTIAL_ENC_KEYS;

if (!encKeys) {
  console.error('Error: CREDENTIAL_ENC_KEYS environment variable is required');
  process.exit(1);
}

rotateCredentials(mongoUri, encKeys)
  .then((res) => {
    console.log(
      `[rotate-credentials] Scanned ${res.totalScanned} servers, re-encrypted ${res.rotatedCount} credentials to active kid: ${res.activeKid}`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('[rotate-credentials] Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
