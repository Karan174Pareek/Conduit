# Conduit System Walkthrough & Architectural Reference

This document provides a verified, production-grade technical walkthrough of the Conduit system based on direct inspection of the live code and running Kubernetes cluster in `/home/karan/conduit`.

---

## 1. Architecture in 10 Lines

1. **Topology**: Single-organisation MCP gateway running on Kubernetes (k3d locally, EKS in production) across isolated namespaces: `conduit-system` (control plane) and `store-default` (WooCommerce tenant backends).
2. **Gateway**: Node.js 22 + TypeScript + Fastify v5 stateless proxy enforcing authentication, upstream connection pooling, circuit breakers, and tool catalog isolation.
3. **Dashboard**: React 19 + TypeScript + Vite 6 Single Page Application served via unprivileged Nginx (UID 101) with strict Content Security Policy (no unsafe-inline, no unsafe-eval).
4. **Upstream MCP Adapter**: Python FastMCP wrapper (`apps/woo-mcp`) bridging JSON-RPC MCP calls to WooCommerce REST API over HTTP with consumer key/secret authentication.
5. **Data Plane**: MongoDB 7 StatefulSet storing users, hashed credentials, sessions, server registrations, tool catalogs, and audit logs.
6. **Ingress Entrypoints**: Managed by Traefik in `kube-system` exposed on host port 80.
7. **Public Routing**: `gateway.<domain>` routes only `/mcp`, `/healthz`, and `/readyz` to the gateway; `dashboard.<domain>` routes `/api` to the gateway and `/` to the dashboard SPA.
8. **Internal-Only Services**: MongoDB (port 27017), Woo-MCP (port 3100), and WordPress/MariaDB have no external Ingress and are unreachable outside the cluster.
9. **Network Isolation**: Enforced via Kubernetes `NetworkPolicy` resources defaulting to default-deny with explicit ingress/egress allowances per workload.
10. **SSRF Guard Status**: Basic URL format validation is implemented in the gateway; NetworkPolicy is NOT an SSRF defence (gateway can reach MongoDB and port 3100 in store namespaces); full DNS rebinding and internal IP blacklisting is deferred to Phase 8.

---

## 2. Repository Map

| Path | Purpose |
| :--- | :--- |
| `apps/gateway/src/config.ts` | Environment validation with Zod, secret parsing, hex-encoded encryption keyrings |
| `apps/gateway/src/logger.ts` | Pino logger configuration with sensitive path redaction rules (REDACTED_PATHS) |
| `apps/gateway/src/app.ts` | Fastify application factory, plugin registration, preHandler hooks |
| `apps/gateway/src/db/` | MongoDB connection utilities, distributed lock, schema types, migration runner |
| `apps/gateway/src/db/migrations/` | Forward-only migrations: `0001_init.ts`, `0002_fix_tool_catalog_indexes.ts`, `0003_audit_and_team.ts` |
| `apps/gateway/src/registry/` | Upstream credential crypto (`crypto.ts`), URL policy (`url-policy.ts`), seed runner (`seed.ts`) |
| `apps/gateway/src/catalog/` | `CatalogService` (`service.ts`): tool sync, canonical hashing, approval workflow; `sanitizer.ts`: description & schema sanitizing |
| `apps/gateway/src/upstream/` | `UpstreamManager` (`manager.ts`): MCP connections, 3-strike circuit breaker, bulkhead, health check loop |
| `apps/gateway/src/router/` | `ToolRouter` (`tool-router.ts`): tool resolution, namespace translation (`<server>__<tool>`), authorization |
| `apps/gateway/src/mcp/` | Streamable HTTP transport and MCP JSON-RPC protocol server (`server.ts`) |
| `apps/gateway/src/middleware/` | Session/cookie auth (`authenticator.ts`), RBAC guards (`roles.ts`), CSRF token verification (`csrf.ts`) |
| `apps/gateway/src/services/` | Argon2id password hashing (`password.ts`), HMAC API key management (`api-keys.ts`), sessions (`sessions.ts`) |
| `apps/gateway/src/routes/` | REST controllers: `auth.ts`, `keys.ts`, `users.ts`, `invites.ts`, `servers.ts`, `audit.ts`, `health.ts`, `mcp.ts` |
| `apps/dashboard/src/` | React 19 SPA: Pages (Login, Servers, Team, Keys, Audit, Connect), UI components, API client |
| `apps/dashboard/nginx.conf` | Non-root Nginx config with strict CSP, security headers, and health probe endpoint |
| `apps/woo-mcp/` | Python FastMCP server converting MCP tool calls to WooCommerce REST API requests |
| `packages/shared/` | Shared TypeScript types, Zod schemas, ConduitError class, and error taxonomy |
| `charts/conduit/` | Helm chart for Gateway, Dashboard, MongoDB, NetworkPolicies, and Ingress |
| `charts/woocommerce-store/` | Helm chart for WooCommerce store: WordPress, MariaDB, Woo-MCP adapter, setup Job |
| `scripts/e2e/` | End-to-end integration and smoke tests (`gateway-flow.ts`, `ui-smoke.ts`) |
| `docs/` | System documentation: PRD, Architecture, Security, Database, Phases, Walkthrough |
| `Makefile` | Automation targets: cluster lifecycle, builds, deployments, testing, security scans |

---

## 3. End-to-End System Flows

### a) Gateway Startup Flow
1. **Config Validation** (`apps/gateway/src/config.ts:validateConfig`): Parses environment variables via Zod. Validates AES-256-GCM keyring, API key pepper, and session secret.
2. **MongoDB Connection** (`apps/gateway/src/db/connection.ts:connectMongo`): Establishes authenticated client connection to MongoDB.
3. **Distributed Migration Lock** (`apps/gateway/src/db/migrations/runner.ts:runMigrations`):
   - Acquires distributed TTL lock in `system_state` (`_id: 'migration_lock'`).
   - Executes pending migrations sequentially: `0001_init.ts` -> `0002_fix_tool_catalog_indexes.ts` -> `0003_audit_and_team.ts`.
   - Records current version in `system_state` (`_id: 'schema', version: 3`).
   - Releases lock cleanly.
4. **Bootstrap Admin Seeding** (`apps/gateway/src/db/seed.ts:seedBootstrapAdmin`): Idempotently seeds initial administrator with Argon2id hash.
5. **First-Party Upstream Seeding** (`apps/gateway/src/registry/seed.ts:seedDefaultServers`): Upserts default WooCommerce server (`slug: 'woo'`, `trusted: true`).
6. **Background Loops Initialization**:
   - `UpstreamManager.startHealthLoop()`: Starts 10-second periodic health check loop.
   - `MongoAuditSink`: Starts 250ms interval batch flush timer.
7. **Readiness Probe** (`apps/gateway/src/routes/health.ts:GET /readyz`): Returns 200 OK once schema version equals latest target (version 3) and MongoDB ping succeeds.

### b) Authentication & Key Lifecycle
1. **Login** (`POST /api/auth/login`): Verifies email and Argon2id password hash. Rejects after 10 failed attempts (lockout). Issues cryptographically random session token (SHA-256 hashed in DB) set in `httpOnly, secure, sameSite=lax` cookie `__Host-conduit_session`. Returns in-memory CSRF token.
2. **Session Verification** (`apps/gateway/src/middleware/authenticator.ts:requireAuth`): Reads cookie, hashes token with SHA-256, validates expiration in `sessions` collection, and loads user role and email into `request.principal`.
3. **CSRF Protection** (`apps/gateway/src/middleware/csrf.ts:verifyCsrfToken`): Validates `x-csrf-token` header on all mutating methods (POST, PUT, PATCH, DELETE) against the session; enforces origin verification against `ALLOWED_ORIGINS`.
4. **API Key Generation** (`POST /api/keys`): Admin or Member creates an API key. Key format: `mcpgw_<prefix>_<secret>`. Stores HMAC-SHA256(secret, pepper) in `api_keys` collection. Returns full plaintext key ONCE.
5. **API Key Verification** (`apps/gateway/src/services/api-keys.ts:verifyApiKey`): Verifies HMAC-SHA256 hash using constant-time comparison against MongoDB. Resolves owner user document.
6. **API Key Domain Restriction**: API keys work ONLY on `POST /mcp`. Any attempt to use an API key on `/api/*` returns 401 Unauthorized.

### c) MCP Tool Execution Flow
1. **Transport**: MCP client (Cursor, Claude Code) sends JSON-RPC `tools/call` to `POST /mcp` with `Authorization: Bearer mcpgw_...`.
2. **Auth Verification**: Gateway validates Bearer token via `verifyApiKey`. Constructs `Principal { userId, email, role, via: 'apikey', keyId, source: 'mcp' }`.
3. **Dispatch**: Handled statelessly by MCP SDK `handleMcpStatelessRequest` (`apps/gateway/src/mcp/server.ts`).
4. **Resolution** (`apps/gateway/src/router/tool-router.ts:call`): Splits exposed name (e.g. `woo_list_products` -> server: `woo`, tool: `list_products`).
5. **Authorization & Quarantine Check**:
   - Queries `tool_catalog`.
   - If tool is not found, not approved, or marked `changed`, returns identical `"Unknown tool"` error (McpError MethodNotFound).
6. **Execution** (`apps/gateway/src/upstream/manager.ts:invokeTool`):
   - **Circuit Breaker Check**: If phase is `open`, immediately throws `circuit_open` (HTTP 503). If `half_open`, allows exactly 1 probe call while rejecting others.
   - **Bulkhead Check**: If in-flight calls >= `maxConcurrent` (default 8), increments rejection metric and throws `upstream_busy` (HTTP 503).
   - **Timeout Enforcement**: Enforces timeout via `AbortController` (default 30s).
   - **Credential Decryption**: Decrypts upstream token using AES-256-GCM.
   - **Upstream Call**: Sends tool call to `apps/woo-mcp` over Streamable HTTP.
   - **Size Check**: If response serialized size > `MAX_RESULT_BYTES` (1 MB), throws `result_too_large` (HTTP 413).
7. **Audit Record**: Records execution asynchronously into `MongoAuditSink` with duration, sanitized argument summary, argument hash, and outcome.

### d) Circuit Breaker State Machine & Health Loop
1. **Location**: Built directly into `apps/gateway/src/upstream/manager.ts`.
2. **Closed Phase**: Normal operation. Failures increment `consecutiveFailures`.
3. **Trip Condition**: 3 consecutive network/timeout/5xx failures (or 1 failure during half-open) trip breaker to `open`. Upstream status is updated to `unreachable`.
4. **Open Phase**: All incoming calls fail immediately with `circuit_open` (HTTP 503) without generating upstream network traffic.
5. **Backoff & Jitter**: Initial backoff is 10 seconds, doubling up to 60 seconds maximum on repeated failures, applied with +/- 20% jitter.
6. **Half-Open Phase**: Once backoff expires, exactly 1 request is permitted through as a probe.
7. **Recovery**: If the probe succeeds, breaker transitions to `closed`, failures reset to 0, backoff resets to 10s, and upstream status resets to `connected`.

### e) Tool Catalog Sanitization & Pinning
1. **Discovery**: `CatalogService.syncServerTools()` fetches raw schemas from upstream.
2. **Text Sanitization** (`apps/gateway/src/catalog/sanitizer.ts:sanitizeText`): Strips zero-width characters, bidi overrides, control characters, and Unicode tag characters. Caps description at 1000 characters.
3. **Schema Validation** (`validateAndSanitizeSchema`): Rejects remote `$ref` (http/https), caps schema depth at 10, and enforces 64 KB schema size limit.
4. **Canonical Hashing**: Computes deterministic SHA-256 hash across sorted JSON keys of { name, description, inputSchema, annotations }.
5. **Auto-Approval**:
   - `const autoApprove = server.trusted || server.approveOnAdd;`
   - Seeded WooCommerce server has `trusted: true`, so its tools are approved automatically on initial sync.
   - Untrusted servers without `approveOnAdd` start in `pending` state.
6. **Tamper Detection (Quarantine)**: If an approved tool's definition hash changes in upstream, its status flips to `changed` (quarantined) until an administrator reviews and approves it.

### f) Audit Pipeline & Admin Events
1. **Queue Architecture**: In-memory ring buffer in `MongoAuditSink` (max 10,000 records). Drops oldest if full.
2. **Flushing**: Background timer flushes every 250ms (or when batch size >= 50) using MongoDB `insertMany({ ordered: false })`.
3. **Retries**: Up to 3 retry attempts with exponential backoff (50ms, 100ms). If all fail, logs error (no fail-closed block, no stderr fallback).
4. **Graceful Shutdown**: Flushes remaining in-flight queue on SIGTERM / application close.
5. **Admin Events**: Synchronous writes to `admin_events` recording security mutations (key issue/revoke, user invite/role change/disable, server add/remove/enable/disable, tool approve). Verified: `actorEmail` always contains `@`.

---

## 4. Kubernetes Workloads & Specifications

Verified from live cluster via `kubectl get deploy,sts -A -o json`:

| Namespace | Kind | Name | Replicas | Image | Requests (CPU/Mem) | Limits (CPU/Mem) | Probes | Security Context | PVCs |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `conduit-system` | Deployment | `conduit-dashboard` | 1 | `conduit/dashboard:0.1.0` | 25m / 32Mi | 100m / 64Mi | R, L | UID 101, RO rootfs, drop ALL | - |
| `conduit-system` | Deployment | `conduit-gateway` | 1 | `conduit/gateway:0.1.0` | 100m / 256Mi | 500m / 512Mi | S, R, L | UID 10001, RO rootfs, drop ALL | - |
| `conduit-system` | StatefulSet | `conduit-mongodb` | 1 | `mongo:7` | 100m / 256Mi | 500m / 512Mi | S, R, L | UID 999, RO rootfs, drop ALL | - (emptyDir) |
| `store-default` | Deployment | `store-woocommerce-store-woo-mcp` | 1 | `conduit/woo-mcp:685c31d` | 50m / 96Mi | 250m / 192Mi | R, L | UID 10001, RO rootfs, drop ALL | - |
| `store-default` | Deployment | `store-woocommerce-store-wordpress` | 1 | `conduit/wordpress:6.7.2-wc9.6.2` | 200m / 384Mi | 1000m / 768Mi | S, R, L | Root exception (Apache), RO rootfs, drop ALL | `wp-content` |
| `store-default` | StatefulSet | `store-woocommerce-store-mariadb` | 1 | `mariadb:11.4.5` | 100m / 256Mi | 500m / 512Mi | S, R, L | Default MariaDB user | - (emptyDir) |
| `kube-system` | Deployment | `traefik` | 1 | `rancher/mirrored-library-traefik:3.6.13` | - / - | - / - | R, L | UID 65532, RO rootfs, drop ALL | - |

*Note: S = Startup Probe, R = Readiness Probe, L = Liveness Probe.*

### Kubernetes Secrets (By Name Only)
- `conduit-system`: `conduit-secrets`, `conduit-gateway-secrets`, Helm release state secrets (`sh.helm.release.v1.conduit.v*`).
- `store-default`: `store-secrets`, Helm release state secrets (`sh.helm.release.v1.store.v*`).
- `kube-system`: `chart-values-traefik`, `k3s-serving`, Traefik release secrets.

---

## 5. Live Database Collections & Indexes

Verified from MongoDB (schema version: **3**, migration: `0003_audit_and_team`):

| Collection | Indexes | TTL Configuration | Purpose |
| :--- | :--- | :--- | :--- |
| `users` | `_id_`, `email_1` (unique), `status_1` | None | User accounts, roles, Argon2id password hashes |
| `sessions` | `_id_`, `tokenHash_1` (unique), `expiresAt_1` | `expiresAt: 0s` | Authenticated web session tokens |
| `api_keys` | `_id_`, `prefix_1`, `keyHash_1` (unique), `ownerId_1_revokedAt_1` | None | Machine API keys for MCP clients |
| `invites` | `_id_`, `tokenHash_1` (unique), `email_1`, `expiresAt_1` | `expiresAt: 7 days (604800s)` | Single-use team onboarding invites |
| `mcp_servers` | `_id_`, `slug_1` (unique), `enabled_1` | None | Upstream server configurations & credentials |
| `tool_catalog` | `_id_`, `exposedName_1` (unique), `serverId_1_name_1` (unique), `approval.status_1` | None | Synchronized tool definitions & hash states |
| `tool_calls` | `_id_`, `ts_-1`, `userId_1_ts_-1`, `serverSlug_1_ts_-1`, `outcome_1_ts_-1`, `ts_1`, `createdAt_1` | `ts: 90 days (7776000s)` | Immutable tool invocation audit log |
| `admin_events` | `_id_`, `ts_-1`, `actorId_1_ts_-1`, `action_1_ts_-1` | None (1-year TTL deferred) | Security audit trail for admin actions |
| `system_state` | `_id_` | None | Migration leases and schema version tracking |

---

## 6. Security Controls Status

| Security Control | Status | Implementation Details |
| :--- | :--- | :--- |
| Argon2id Password Hashing | **IMPLEMENTED** | `apps/gateway/src/services/password.ts` (memory: 64 MB, iterations: 3, parallelism: 4) |
| HMAC-SHA256 API Keys | **IMPLEMENTED** | `apps/gateway/src/services/api-keys.ts` with cluster pepper and constant-time compare |
| AES-256-GCM Credential Encryption | **IMPLEMENTED** | `apps/gateway/src/registry/crypto.ts` with key rotation and AAD binding |
| In-Memory CSRF Tokens | **IMPLEMENTED** | `apps/gateway/src/middleware/csrf.ts` & `apps/dashboard/src/api/client.ts` (never in localStorage) |
| Strict CSP (Nginx) | **IMPLEMENTED** | `apps/dashboard/nginx.conf` (default-src 'self'; script-src 'self'; frame-ancestors 'none') |
| Dynamic Route Classification Test | **IMPLEMENTED** | `apps/gateway/tests/route-classification.test.ts` verifying 100% of Fastify routes |
| Tool Quarantine on Hash Change | **IMPLEMENTED** | `apps/gateway/src/catalog/service.ts` (auto-quarantines modified upstream tools) |
| CSV Injection Neutralization | **IMPLEMENTED** | `apps/gateway/src/audit/redaction.ts:sanitizeCsvCell` (prepends ' to =, +, -, @, \t, \r) |
| Distributed Migration Lease | **IMPLEMENTED** | `apps/gateway/src/db/migrations/runner.ts` using MongoDB TTL locks |
| Sensitive Log Redaction | **IMPLEMENTED** | `apps/gateway/src/logger.ts` (redacts authorization, cookie, credential, password, apiKey) |
| Response Size Cap (1 MB) | **IMPLEMENTED** | `apps/gateway/src/upstream/manager.ts` (aborts and throws `result_too_large` at 1 MB) |
| Circuit Breaker & Bulkhead | **IMPLEMENTED** | `apps/gateway/src/upstream/manager.ts` (3 failures, 10s-60s backoff, bulkhead 8) |
| Distributed Rate Limiting | **NOT YET** | `NoopRateLimiter` interface in place; cluster-wide Redis rate limiter deferred to Phase 8 |
| SSRF Deep IP/DNS Blacklist | **NOT YET** | Format checked by `assertValidServerUrl`; DNS pinning & IP ranges deferred to Phase 8 |
| Key Rotation Automation Script | **NOT YET** | Multi-key decryption works in code; automated DB re-encryption CLI deferred to Phase 8 |
| Admin Events 1-Year TTL Index | **NOT YET** | Migration 0003 added tool_calls TTL (90d); admin_events 1-year TTL index deferred |

---

## 7. Test Coverage

Verified via Vitest test runs:

### a) Gateway Tests (20 files, 73 tests passed)
- `api-keys.test.ts` (2): Key generation, HMAC verification, revocation.
- `audit-sink.test.ts` (5): Queue buffering, batch inserts, CSV formula sanitization, drop metrics.
- `circuit-breaker.test.ts` (5): 3-strike trip, backoff recovery, probe in half-open, bulkhead capacity, 1 MB result_too_large check.
- `config.test.ts` (6): Zod environment validation, hex key parsing, required secrets.
- `crypto.test.ts` (4): AES-256-GCM encryption/decryption, AAD tampering detection, key rotation.
- `csrf.test.ts` (2): Double-submit CSRF validation, origin matching.
- `graceful-shutdown.test.ts` (1): In-flight request completion and audit drain on SIGTERM.
- `integration.test.ts` (7): Real MongoDB startup, migrations, authentication, account lockout after 10 failures.
- `logger-redaction.test.ts` (1): Pino log redaction across headers and request bodies.
- `mcp-integration.test.ts` (4): Streamable HTTP MCP dispatch, configVersion cache invalidation.
- `migration-0002.test.ts` (2): Migration 0002 idempotency and index repair.
- `password.test.ts` (2): Argon2id hashing, length validation.
- `roles.test.ts` (3): Fastify RBAC middleware enforcement.
- `route-classification.test.ts` (3): Route table classification proof, 401 on API keys on /api/*, 403 on members, real actorEmail validation.
- `sanitizer.test.ts` (7): Unicode tag & bidi stripping, 1000 char cap, schema depth limit, 64 KB schema size limit, remote $ref rejection, canonical hash stability.
- `secret-leakage.test.ts` (1): Scans test logs to ensure zero secret leakage.
- `sessions.test.ts` (3): Session creation, SHA-256 token lookup, expiration.
- `stats-and-tools.test.ts` (7): Server stats aggregation, tool listing, admin tool approval.
- `team-management.test.ts` (5): User listing, self-demote & last-admin protections, invite creation & acceptance.
- `tool-router.test.ts` (3): Tool routing, name translation, quarantine of unapproved tools.

### b) Woo-MCP Tests (4 files, 17 tests passed)
- `auth.test.ts` (6): Bearer token validation, unauthorized rejection.
- `dates.test.ts` (4): ISO 8601 parsing and query parameters.
- `store-client.test.ts` (5): WooCommerce REST client retries, error handling.
- `tools.test.ts` (2): Product listing and order lookup tool dispatch.

### c) Dashboard Tests (2 files, 7 tests passed)
- `client.test.ts` (3): ApiError mapping, CSRF header injection, 401 redirect clearing token.
- `components.test.tsx` (4): Role-aware layout, write-only server credential input, memory wiping on modal close, plain-text description rendering (no dangerouslySetInnerHTML).

---

## 8. Known Gaps & Blunt Risk Assessment

1. **SSRF Guarding is Basic**: `assertValidServerUrl` validates URL syntax, but does not resolve DNS to verify the destination IP is not a cloud metadata service (169.254.169.254) or an internal Kubernetes service. Full DNS-pinned egress proxying is deferred to Phase 8.
2. **Rate Limiting is Currently No-Op**: In `apps/gateway/src/router/tool-router.ts`, the rate limiter uses `NoopRateLimiter`. True rate limiting requires Redis integration in Phase 8.
3. **Audit Sink Drops Under Extreme Backpressure**: If MongoDB experiences an extended outage and the in-memory queue exceeds 10,000 items, records are dropped with warning logs. There is no disk spooling or stderr fallback.
4. **Admin Events Retention**: `admin_events` collection currently lacks a MongoDB TTL index (spec recommends 1 year). Rows persist indefinitely until a cleanup migration is run.

---

## 9. How to Run and Demo

### Prerequisites
- k3d v5+, kubectl, Docker, Node.js 22, Helm v3.
- Update `/etc/hosts` (or Windows `hosts`):
  ```text
  127.0.0.1 dashboard.localhost gateway.localhost shop.localhost
  ```

### Commands
```bash
# 1. Start local k3d cluster with port 80 mapped to Traefik
make cluster-up

# 2. Deploy infrastructure and applications
make deploy-local

# 3. Verify rollout status
kubectl get pods -A

# 4. Run automated E2E Gateway flow
make e2e-gateway

# 5. Run automated Playwright UI Smoke test
make e2e-ui
```

---

## 10. Architectural Interview Q&A

1. **How does the Gateway verify API keys on `/mcp` without storing plaintext secrets?**
   API keys use the format `mcpgw_<prefix>_<secret>`. The gateway hashes the secret using HMAC-SHA256 with a cluster pepper (`API_KEY_PEPPER`) and performs a constant-time comparison against `keyHash` in MongoDB, preventing timing attacks and database compromise leakage.

2. **Why are API keys strictly forbidden on `/api/*` endpoints?**
   To enforce least privilege and credential domain separation: API keys are machine tokens meant solely for LLM tool invocation (`POST /mcp`), whereas `/api/*` manages users, servers, and configuration, strictly requiring human session cookies and double-submit CSRF tokens.

3. **How does Conduit prevent tool enumeration or server scanning when an unapproved or quarantined tool is requested?**
   When `ToolRouter` encounters an unapproved tool, a quarantined schema change, or an unauthorized server, it returns an identical `"Unknown tool"` error as if the tool never existed, ensuring no differential timing or error leaks.

4. **How does the Circuit Breaker protect degraded upstreams from cascading failure?**
   If an upstream fails 3 consecutive requests (or 1 probe in half-open), the breaker trips to `open`, failing fast with `[gateway:circuit_open]` (HTTP 503) for 10s doubling up to 60s with +/-20% jitter. In half-open, a single probe is allowed while concurrent calls receive circuit_open.

5. **Why is the database migration runner protected by a distributed lease?**
   Because the gateway is designed to scale horizontally across multiple replicas. A MongoDB TTL-based distributed lock on `system_state._id='migration_lock'` guarantees only one replica executes forward-only migrations at startup while other replicas wait before serving traffic.

6. **How does the Gateway protect CSV audit logs from formula injection (CSV Injection / DDE)?**
   Before rendering any user-controlled string into CSV cells, `sanitizeCsvCell` checks if the string begins with `=`, `+`, `-`, `@`, `\t`, or `\r`. If detected, it prepends a single quote (`'`), neutralizing spreadsheet formula execution.

7. **How does Conduit isolate single-organisation audit records between team members and administrators?**
   Audit queries for non-admin members automatically inject `{ userId: principal.userId }` at the database query layer, preventing members from viewing peers' tool executions or argument payloads even with modified query parameters.

8. **What prevents an attacker who discovers an upstream server URL from accessing other cluster services via SSRF?**
   NetworkPolicy is NOT an SSRF defence; the gateway can reach Mongo:27017 and port 3100 across store namespaces. Currently, `assertValidServerUrl` validates URL syntax; full DNS rebinding and internal IP blacklisting is deferred to Phase 8.

9. **Why does Traefik require custom `ServersTransport` forwarding timeouts for the Gateway Ingress?**
   MCP uses streamable HTTP and Server-Sent Events (SSE) for tool execution streams that can take 30 to 120 seconds during complex tool operations. Custom `responseHeaderTimeout: 120s` and `readIdleTimeout: 120s` in Traefik (running in `kube-system`) prevent the proxy from prematurely severing long-lived connections.

10. **How does the system ensure zero secret leakage in logs when upstream credentials or passwords fail?**
    Pino is configured with strict redaction paths covering `authorization`, `cookie`, `credential`, `password`, and `apiKey`. Additionally, `MongoAuditSink` redacts sensitive JSON keys and hashes raw payloads before persistence, verified by automated tests scanning 100% of captured log lines.
\`;

fs.writeFileSync('/home/karan/conduit/docs/WALKTHROUGH.md', doc, 'utf8');
console.log('Successfully wrote audited docs/WALKTHROUGH.md');
