# DATABASE

Two data stores exist. Only the first is yours to design.

1. **MongoDB (`conduit` database)**: gateway state. Documented here.
2. **MariaDB per store**: owned by WordPress/WooCommerce. You never write to it directly except the setup Job inserting the REST consumer key (and you never query it from the gateway).

## 1. Conventions

- IDs: `_id` is an `ObjectId`; external references use the string form. Use `zod` schemas in `packages/shared` as the single source of truth; validate on every write.
- Timestamps: UTC `Date`; `createdAt`, `updatedAt` on every mutable collection.
- Soft state over hard deletes for security objects (keys, users): `revokedAt`, `disabledAt`.
- No secret is stored in plaintext. Hashes and ciphertexts only.
- Driver: official `mongodb` driver (or Mongoose if you prefer; keep schemas in zod either way). Connection string from a Secret; app user has `readWrite` on `conduit` only.
- All queries that serve a member filter by `userId` in the query itself, never after fetching.

## 2. Collections

### 2.1 `users`
```json
{
  "_id": "ObjectId",
  "email": "a@b.com",              // lowercased, unique
  "name": "Asha",
  "role": "admin | member",
  "passwordHash": "argon2id$...",  // null until invite accepted
  "status": "invited | active | disabled",
  "failedLogins": 0, "lockedUntil": null,
  "lastLoginAt": null,
  "createdAt": "", "updatedAt": "", "disabledAt": null
}
```
Indexes: `{email:1}` unique. Bootstrap admin is upserted at startup from env if no admin exists.

### 2.2 `invites`
```json
{ "_id": "", "email": "", "role": "member", "tokenHash": "sha256(token)", "invitedBy": "userId",
  "expiresAt": "", "usedAt": null, "createdAt": "" }
```
Indexes: `{tokenHash:1}` unique; TTL on `expiresAt` + 7 days. The raw token is shown once in the dashboard link.

### 2.3 `sessions`
```json
{ "_id": "sha256(sessionId)", "userId": "", "csrfToken": "", "createdAt": "", "lastSeenAt": "",
  "expiresAt": "", "ip": "", "userAgent": "" }
```
Indexes: TTL on `expiresAt`; `{userId:1}` (to kill all sessions on disable/password change). Idle timeout 8 h sliding, absolute 7 d.

### 2.4 `api_keys`
```json
{
  "_id": "", "userId": "", "name": "Claude Code laptop",
  "prefix": "a1b2c3d4",                 // public lookup id, 8 chars
  "hash": "hmac-sha256(pepper, fullKey)", // hex
  "last4": "9f2e",
  "createdAt": "", "expiresAt": null, "lastUsedAt": null, "lastUsedIp": null,
  "revokedAt": null, "revokedBy": null
}
```
Format shown to the user once: `mcpgw_<prefix>_<32 bytes base64url>`.
Verification: find by `prefix` → recompute HMAC → `timingSafeEqual` → check `revokedAt == null`, `expiresAt`, owner `status == active`.
Indexes: `{prefix:1}` unique; `{userId:1, revokedAt:1}`.
`lastUsedAt` is updated at most once per minute per key (avoid write amplification).
Why HMAC with pepper instead of argon2: keys are 256-bit random, so brute force is infeasible; a fast keyed hash keeps per-request cost negligible, and the pepper (in a Secret) means a database leak alone cannot be used to verify guesses.

### 2.5 `mcp_servers`
```json
{
  "_id": "", "slug": "woo", "displayName": "WooCommerce (default store)",
  "url": "http://woo-mcp.store-default.svc.cluster.local:3100/mcp",
  "enabled": true,
  "trusted": true,                       // set only by seed/provisioner, never via public API
  "system": true,                        // cannot be deleted or have its credential edited in UI
  "origin": "seed | admin | provisioner",
  "auth": { "type": "none | bearer | header", "headerName": null,
            "ciphertext": "base64", "iv": "base64", "tag": "base64", "kid": "k1" },
  "callTimeoutMs": 30000,
  "maxConcurrent": 8,
  "approveOnAdd": false,
  "status": {                            // written by the health loop (last writer wins, informational)
    "state": "connected | unreachable | disabled",
    "reasonCode": null, "reason": null, "checkedAt": "", "lastSuccessAt": ""
  },
  "storeId": null,                       // bonus: link to stores
  "createdBy": "userId", "createdAt": "", "updatedAt": ""
}
```
Credential encryption: AES-256-GCM, 12-byte random IV, AAD = `_id`, key by `kid` from `CREDENTIAL_ENC_KEYS`. Rotation: add a new key first in the list, run `scripts/rotate-credentials` to re-encrypt, then retire the old key.
API responses expose `hasCredential: boolean` and `authType`, never the ciphertext.
Indexes: `{slug:1}` unique; `{enabled:1}`.

### 2.6 `tool_catalog`
Latest known tool definitions per server and their approval state. One document per `(serverId, name)`.
```json
{
  "_id": "", "serverId": "", "name": "list_orders",
  "exposedName": "woo__list_orders",
  "description": "sanitised text", "descriptionRaw": "as received (admin-only view)",
  "inputSchema": {}, "annotations": { "readOnlyHint": true },
  "hash": "sha256(canonical json)",
  "approval": { "status": "approved | pending | changed", "approvedHash": "", "approvedBy": "", "approvedAt": "" },
  "firstSeenAt": "", "lastSeenAt": "", "removedAt": null
}
```
Indexes: `{serverId:1, name:1}` unique; `{exposedName:1}` unique.
`removedAt` is set when the upstream stops listing a tool; the row is kept for audit and diffs.

### 2.7 `policies`
```json
{ "_id": "", "scope": "role | user", "role": "member", "userId": null,
  "serverId": "*", "toolPattern": "create_*", "effect": "allow | deny",
  "note": "members cannot create", "createdBy": "", "createdAt": "" }
```
Indexes: `{scope:1, role:1}`, `{userId:1}`. The effective policy is cached in memory and invalidated through `configVersion`.

### 2.8 `tool_calls` (the audit log)
```json
{
  "_id": "", "ts": "2026-10-09T10:15:00Z", "requestId": "",
  "userId": "", "userEmail": "snapshot", "role": "member",
  "via": "apikey | session", "keyId": null, "source": "mcp | chat", "conversationId": null,
  "serverId": "", "serverSlug": "woo", "tool": "list_orders", "exposedName": "woo__list_orders",
  "durationMs": 182,
  "outcome": "success | error | timeout | denied | unreachable | rate_limited | invalid | quarantined",
  "errorCode": null, "errorMessage": null,
  "argsSummary": "status=processing after=2026-10-09",
  "argsHash": "sha256", "resultBytes": 1840, "upstreamIsError": false
}
```
What is stored: a **redacted, truncated** `argsSummary` (200 chars, secret-looking keys and values masked) plus `argsHash`. Full arguments and results are **not** stored (PII, size). A deployment flag `AUDIT_STORE_ARGS=full` exists for debugging and defaults to off.
Indexes: `{ts:-1}`; `{userId:1, ts:-1}`; `{serverSlug:1, ts:-1}`; `{outcome:1, ts:-1}`; TTL on `ts` per `AUDIT_RETENTION_DAYS` (default 90) if you want retention.
Immutability: the app role cannot update/delete; there is no API to mutate rows. (Optional: hash-chain field `prevHash` per day for tamper evidence.)

### 2.9 `admin_events`
```json
{ "_id": "", "ts": "", "actorId": "", "actorEmail": "", "action": "server.add | server.update | server.disable | server.remove | key.issue | key.revoke | user.invite | user.disable | policy.update | tool.approve | login.fail | login.lockout",
  "target": { "type": "server", "id": "", "label": "" }, "details": {}, "requestId": "", "ip": "" }
```
Written synchronously (these must not be dropped). Secrets never appear in `details`.
Indexes: `{ts:-1}`, `{actorId:1, ts:-1}`, `{action:1, ts:-1}`.

### 2.10 `conversations` and `messages`
```json
// conversations
{ "_id": "", "userId": "", "title": "Today's orders", "createdAt": "", "updatedAt": "" }
// messages
{ "_id": "", "conversationId": "", "userId": "", "role": "user | assistant | tool",
  "content": "text", "toolCalls": [{ "id": "", "name": "woo__list_orders", "args": {}, "ok": true, "durationMs": 180, "summary": "3 orders" }],
  "usage": { "inputTokens": 0, "outputTokens": 0 }, "createdAt": "" }
```
Indexes: `{userId:1, updatedAt:-1}` on conversations; `{conversationId:1, createdAt:1}` on messages. Tool results are stored as a short `summary` plus capped payload (8 KB) so the history can be replayed to the model; cascade delete messages with the conversation.

### 2.11 `rate_limits` (only if Redis is not used)
Token-bucket state per key or user: `{ _id: "key:<id>", tokens, updatedAt }` with TTL. Prefer Redis in prod; this exists so a single-replica install has zero extra dependencies. The in-memory limiter is the default; this is optional.

### 2.12 `system_state`
```json
{ "_id": "config", "configVersion": 42, "updatedAt": "" }
{ "_id": "schema", "version": 7, "appliedAt": "" }
{ "_id": "reconciler-lease", "holder": "pod-abc", "expiresAt": "" }   // bonus
```
`configVersion` is incremented (atomic `$inc`) by every registry, policy and approval write. Replicas poll it every 5 s.

### 2.13 `stores` (bonus)
```json
{
  "_id": "", "ownerId": "", "name": "Acme Shoes", "slug": "acme-shoes",
  "namespace": "store-acme-shoes", "host": "acme-shoes.stores.localhost", "url": "http://acme-shoes.stores.localhost",
  "state": "requested | provisioning | ready | failed | deleting | deleted",
  "step": "namespace | quota | secrets | helm | wait_ready | register | done",
  "failure": { "code": "helm_timeout", "message": "..." },
  "helmRelease": "store-acme-shoes", "attempts": 1,
  "mcpServerId": null,
  "createdAt": "", "readyAt": null, "deadlineAt": "", "deletedAt": null, "updatedAt": ""
}
```
Indexes: `{slug:1}` unique (idempotent create); `{ownerId:1, state:1}` for the per-user cap; `{state:1, deadlineAt:1}` for the reconciler.
Per-user cap is enforced by a conditional insert: count non-deleted stores for the owner inside a transaction (requires a replica set) or with a unique `{ownerId, ordinal}` guard if you stay on standalone Mongo (ordinal 1..MAX).

## 3. State machines

### 3.1 Server status (derived)
```
disabled      : enabled == false (always wins)
connected     : enabled && breaker closed && last health ok
unreachable   : enabled && (breaker open | health failing | auth failed upstream)
```
`reasonCode` is one of: `connect_failed`, `timeout`, `upstream_auth_failed`, `protocol_error`, `circuit_open`, `ssrf_blocked`, `tls_error`, `dns_error`. The dashboard shows the code and a human message.

### 3.2 Tool approval
```
(new tool) -> pending --approve--> approved --definition changes--> changed --approve--> approved
                                   approved --upstream drops tool--> removedAt set
```

### 3.3 Store lifecycle (bonus)
```
requested -> provisioning -> ready
                 |             |
                 +-> failed    +-> deleting -> deleted
failed -> (retry) provisioning        failed -> deleting -> deleted
```

## 4. Migrations

- A tiny versioned runner (`migrations/0001_init.ts`, ...) executed by a Helm **pre-install/pre-upgrade hook Job** using the gateway image (`node dist/migrate.js`). Records the version in `system_state.schema`.
- Rule: **expand then contract.** A release may add collections, fields and indexes; removing or renaming happens one release later. This keeps `helm rollback` safe.
- The gateway refuses to start if `schema.version` is lower than the minimum it requires (clear error, not a crash loop of random failures).
- Index creation uses `background` builds and `createIndex` is idempotent.

## 5. Retention, backup, restore

| Data | Retention | Notes |
|---|---|---|
| `tool_calls` | 90 days (value) | TTL index; export CSV before expiry if needed |
| `admin_events` | 1 year | |
| `sessions` | TTL | |
| `messages` | until user deletes | |
| MongoDB backup | nightly `mongodump` CronJob to a PVC (prod: object storage) | Restore drill documented in the README |
| MariaDB backup | nightly `mariadb-dump` per store | Same |

## 6. Seeding (idempotent)

A post-install Job (or gateway start-up task) upserts:
- bootstrap admin (only if no admin exists);
- first-party servers `woo`, `notes`, `utils` with `trusted: true`, `system: true`, `origin: seed`; credentials come from Secrets, never from values files.
Re-running changes nothing unless the Secret or URL changed.

## 7. Performance notes

- `tools/list` never touches Mongo on the hot path: catalog and policy are in memory, refreshed on `configVersion` change.
- Audit writes are batched (`insertMany` every 250 ms or 50 rows) from a bounded in-memory queue.
- Audit list queries are cursor-paginated by `_id`/`ts`, never `skip` on large offsets.
