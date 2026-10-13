# Conduit System Walkthrough & Architectural Reference

## 1. Architecture Overview
Conduit is a multi-tenant, secure Model Context Protocol (MCP) gateway and governance proxy connecting AI assistants to business backends (such as WooCommerce stores). The system runs in a Kubernetes cluster across segregated namespaces: `conduit-system` (gateway core, MongoDB datastore, Traefik ingress controller) and per-store tenant namespaces (e.g. `store-default` housing WordPress, MariaDB, and the `woo-mcp` service).
Public traffic enters via Traefik Ingress: `gateway.<domain>` exposes only `POST /mcp` (streamable HTTP MCP front-door requiring bearer API keys) and health probes (`/healthz`, `/readyz`); `dashboard.<domain>` exposes `/api/*` REST endpoints (requiring httpOnly session cookies and CSRF double-submit tokens) while leaving `/` reserved for the upcoming web dashboard. Internal services (MongoDB, MariaDB, WordPress admin, woo-mcp) are strictly ClusterIP-only. Network isolation is enforced cluster-wide via default-deny `NetworkPolicy` manifests with explicit allowlists: gateway connects to MongoDB (27017) and woo-mcp (3100), woo-mcp connects only to WordPress REST (80), and all cross-namespace or unlabelled pod access is denied.

---

## 2. Repository Map

| Path | Purpose / Contents |
|---|---|
| `apps/gateway/` | Fastify-based MCP gateway core, registry, auth, tool routing, upstream resilience, and REST APIs |
| `apps/gateway/src/index.ts` | Entry point: loads config, establishes Mongo connection, executes migrations, seeds bootstrap data, starts server |
| `apps/gateway/src/app.ts` | `buildApp()` factory: registers Fastify plugins, error handlers, and sets up service instances |
| `apps/gateway/src/config.ts` | Zod schema validation for environment variables, secrets parsing, encryption key ring decoding |
| `apps/gateway/src/logger.ts` | Pino logger configuration with sensitive field redaction rules (`REDACTED_PATHS`) |
| `apps/gateway/src/db/` | MongoDB connection utilities, distributed lock, types, and forward-only migration runner |
| `apps/gateway/src/db/migrations/` | Database migrations: `0001_init.ts` (core collections), `0002_fix_tool_catalog_indexes.ts` (catalog compound indexes), `0003_audit_and_team.ts` (audit & events TTL) |
| `apps/gateway/src/registry/` | Upstream credential crypto (`crypto.ts`), URL security policy (`url-policy.ts`), bootstrap seeding (`seed.ts`) |
| `apps/gateway/src/catalog/` | `CatalogService`: tool discovery, description sanitization, schema hashing, approval workflows |
| `apps/gateway/src/upstream/` | `UpstreamManager`: upstream MCP client connections, per-server circuit breakers, bulkheads, health probes |
| `apps/gateway/src/router/` | `ToolRouter`: route resolution, namespacing (`<server>__<tool>`), authorization, quarantine/approval checks |
| `apps/gateway/src/mcp/` | Model Context Protocol streamable HTTP front-door transport and JSON-RPC dispatch |
| `apps/gateway/src/middleware/` | Authentication (`authenticator.ts` - cookie/bearer separation), roles (`roles.ts`), CSRF protection (`csrf.ts`) |
| `apps/gateway/src/services/` | Business services: Argon2id password hashing (`password.ts`), HMAC API keys (`api-keys.ts`), sessions (`sessions.ts`) |
| `apps/gateway/src/audit/` | Async bounded audit queue (`sink.ts`), log redaction & CSV formula neutralization (`redaction.ts`) |
| `apps/gateway/src/routes/` | REST routes: `auth.ts`, `keys.ts`, `servers.ts`, `audit.ts`, `invites.ts`, `users.ts`, `health.ts`, `mcp.ts` |
| `apps/gateway/tests/` | Vitest integration and unit test suites (27 test files covering security, auth matrix, router, breaker, netpol) |
| `apps/woo-mcp/` | Dedicated MCP server exposing WooCommerce REST API as MCP tools (`list_products`, `update_order`, etc.) |
| `packages/shared/` | Shared TypeScript domain contracts, interfaces, error types (`ConduitError`), and constants |
| `charts/conduit/` | Helm chart for the Conduit control plane (Gateway, MongoDB, Ingress, NetworkPolicies, ServiceMonitor) |
| `charts/woocommerce-store/` | Helm chart for WooCommerce store instance (WordPress, MariaDB, woo-mcp, NetworkPolicies, setup Job) |
| `scripts/` | Operational scripts: cluster lifecycle (`cluster-up.sh`), netpol verification (`test-netpol-proof.sh`), E2E flow (`e2e/gateway-flow.ts`) |
| `images/` | Dockerfiles and container configurations for custom service images |
| `docs/` | Architectural specifications: `ARCHITECTURE.md`, `SECURITY.md`, `DATABASE.md`, `ERROR_HANDLING.md`, `PHASES.md` |
| `values/` | Helm values configurations: `values-local.yaml` (k3d local dev) and `values-prod.yaml` (production TLS/SSO) |
| `Makefile` | Standardized development targets: `build`, `test`, `lint`, `typecheck`, `helm-lint`, `deploy-local`, `e2e-gateway` |

---

## 3. End-to-End System Flows

### a) Gateway Startup & Readiness
1. `index.ts:main()` calls `loadConfig(process.env)` (`config.ts`), parsing and validating secrets (MongoDB URI, encryption key ring, session secret, API key pepper).
2. `connectMongo()` initializes a MongoDB connection pool.
3. `runMigrations(db, lockHolderId)` acquires a MongoDB distributed lease on `system_state._id='migration_lock'` with TTL heartbeat. If locked, waits up to 60s. Runs forward-only migrations (`0001_init`, `0002_fix_tool_catalog_indexes`, `0003_audit_and_team`) updating `system_state._id='schema'`.
4. `seedDefaultServers(db, config, crypto)` idempotently creates the bootstrap admin user (if absent) and registers the system `woo` server upstream using `CredentialCrypto.encrypt()`.
5. `buildApp(config, db, deps)` wires `UpstreamManager`, `CatalogService`, `ToolRouter`, and `MongoAuditSink`.
6. `UpstreamManager.start()` connects to all enabled upstreams in parallel, polls tools, and initiates background health checks (`runHealthLoop()` every 10s).
7. `app.listen({ port, host })` binds Fastify. Probe `GET /readyz` checks DB ping and `schemaVersion === 3`; flips to 503 upon receiving `SIGTERM` while in-flight drain completes.

### b) Authentication & Key Lifecycle
1. **Login**: Client posts credentials to `POST /api/auth/login` (`routes/auth.ts`). `verifyPassword(hash, pass)` executes Argon2id constant-time verification. On failure, increments `failedLoginAttempts`; after 10 failures, sets `lockedUntil = now + 15m`. On success, resets counter, generates a cryptographically random 256-bit session token, stores SHA-256 hash in `sessions` collection (8h sliding TTL), and issues httpOnly, SameSite=Lax cookie plus returns in-memory `csrfToken`.
2. **Session Verification**: Requests to `/api/*` pass `requireAuth()` (`middleware/authenticator.ts`). Session cookie is hashed and checked against `sessions`. If user is disabled (`disabled === true`), 401 Unauthorized is returned immediately. Populates `request.principal = { userId, email, role, via: 'session' }`.
3. **API Key Generation**: Member sends `POST /api/keys` with `x-csrf-token`. `createApiKey()` generates `mcpgw_<prefix>_<secret>`. Generates HMAC-SHA256 hash with server pepper `API_KEY_PEPPER`. Stores prefix, keyHash, and metadata in `api_keys`. Returns raw secret to user once.
4. **API Key Verification**: On `POST /mcp`, `mcpRoutes` validates bearer token against HMAC hash in DB. Rejects disabled user, expired keys, or revoked keys with identical 401. API keys are strictly rejected on all `/api/*` endpoints.

### c) MCP Tool Execution (`tools/call`)
1. Client POSTs streamable HTTP / JSON-RPC to `/mcp` with `Authorization: Bearer mcpgw_...`.
2. `mcp.ts` authenticates bearer key and delegates to `ToolRouter.callTool(principal, toolName, args)`.
3. `ToolRouter` splits exposed name `<server>__<tool>` into upstream slug and tool name.
4. Checks approval status in `tool_catalog`: if tool is pending, quarantined, or disabled, returns identical generic `"Unknown tool"` error (preventing tool enumeration).
5. Invokes `UpstreamManager.callTool(serverSlug, toolName, args)`:
   - Evaluates Circuit Breaker (`circuit-breaker.ts`): if state is `open`, immediately returns `[gateway:circuit_open]` (fast fail, 0 upstream traffic).
   - Evaluates Bulkhead (`bulkhead.ts`): enforces concurrency cap (default 10); if full, returns `[gateway:bulkhead_rejected]`.
   - Acquires client, decrypts bearer credential via `CredentialCrypto.decrypt()`, and sends JSON-RPC `tools/call` over streamable HTTP with timeout (`callTimeoutMs`).
6. Upstream response is received: results exceeding `MAX_RESULT_BYTES` (512 KB) are trimmed with `[TRUNCATED]` indicator.
7. Logs event and enqueues record into `MongoAuditSink` (async bounded queue) recording duration, sanitized argument summary, argument hash, and outcome.

### d) Upstream Health Loop & Circuit Breaker Recovery
1. `UpstreamManager.runHealthLoop()` runs every 10s: executes lightweight ping / `tools/list` on each upstream.
2. If upstream fails 5 consecutive times within rolling window, `CircuitBreaker` trips to `OPEN`.
3. Subsequent tool calls immediately fail with `[gateway:upstream_unreachable]`. Server status in `mcp_servers` updates to `{ state: 'unreachable', reasonCode: 'upstream_unreachable' }`.
4. After `resetTimeoutMs` (30s), Circuit Breaker enters `HALF_OPEN`, allowing a single probe request.
5. If probe succeeds, Circuit Breaker resets to `CLOSED`, server state flips to `healthy`, and tools resume normal routing automatically.

### e) Tool Catalog Sanitization & Pinning
1. During upstream sync, `CatalogService.syncServerTools()` fetches tool schemas.
2. Computes canonical SHA-256 hash of tool JSON Schema and sanitized description.
3. If new: if server has `approveOnAdd: true`, marks `approved`; otherwise marks `pending`.
4. If existing tool hash changed: resets status to `changed` (quarantined) so modified upstream tools cannot execute without re-approval.
5. Tool descriptions are sanitized: strips HTML/script tags, escapes markdown injection vectors, preserving raw description only for admin inspection.

### f) Audit Pipeline & Admin Events
1. Tool invocations push `AuditRecord` to `MongoAuditSink.push()`. Queue is bounded (max 5,000 in-memory). If queue reaches capacity, drops oldest and increments metric `gateway_audit_dropped_total`.
2. Batch worker flushes records every 500ms or 50 items using MongoDB `insertMany()` into `tool_calls`.
3. Arguments undergo key redaction (`redactSensitiveKeys()`: censors keys matching `password`, `token`, `secret`, `authorization`, `credit_card`).
4. Sensitive administrative actions (`key.issue`, `user.invite`, `tool.approve`, etc.) synchronously insert into `admin_events` recording real `actorEmail`.
5. Both `tool_calls` and `admin_events` collections utilize MongoDB TTL indexes (default 90 days retention).

---

## 4. Kubernetes Infrastructure & Workloads

### Namespaces & Pods
- **`conduit-system`**:
  - `conduit-gateway` (Deployment, 2 replicas in prod, 1 in local dev): listening on port 3000, non-root user `10001`, read-only rootfs, `seccompProfile: RuntimeDefault`, `drop: [ALL]`.
  - `conduit-mongodb-0` (StatefulSet, 1 replica): persistent storage via PVC `data-conduit-mongodb-0` (local-path), port 27017.
  - `traefik` (Ingress controller, DaemonSet/Deployment in `kube-system`).
- **`store-default`**:
  - `store-woocommerce-store-wordpress` (Deployment): port 80. Official Apache image starts as root to bind port 80 and switches to `www-data` (UID 33). Drops capabilities except `CHOWN, SETUID, SETGID, NET_BIND_SERVICE, DAC_OVERRIDE` (documented security exception).
  - `store-woocommerce-store-mariadb-0` (StatefulSet): port 3306, backed by PVC.
  - `store-woocommerce-store-woo-mcp` (Deployment): Node.js service port 3100, non-root, read-only rootfs.

### Kubernetes Secrets (by Name)
- `conduit-secrets`: Contains `MONGO_URI`, `SESSION_SECRET`, `API_KEY_PEPPER`, `CREDENTIAL_ENC_KEYS`, `BOOTSTRAP_ADMIN_PASSWORD`, `WOO_MCP_BEARER_TOKEN`, `GEMINI_API_KEY`.
- `conduit-gateway-tls`: Ingress TLS certificate and private key (in production managed by cert-manager).
- `store-woocommerce-store-secret`: MariaDB passwords and WordPress credentials.

### NetworkPolicies
- `conduit-default-deny` & `store-woocommerce-store-default-deny`: Blanket ingress and egress deny across all pods.
- `conduit-mongodb`: Allows ingress on port 27017 *only* from pods matching `app.kubernetes.io/name: gateway` in `conduit-system`.
- `conduit-gateway`: Allows ingress from ingress controller (web entrypoint) on port 3000; allows egress to kube-dns (53), MongoDB (27017), and store namespaces on port 3100 (`woo-mcp`).
- `store-woocommerce-store-woo-mcp`: Allows ingress on port 3100 *only* from gateway pods; egress *only* to WordPress service on port 80.
- All direct external/unlabelled connections to MongoDB or woo-mcp are rejected.

---

## 5. Database Schema & Collections

**Database**: `conduit` (MongoDB 7.0) | **Current Schema Version**: `3` (managed via `0003_audit_and_team.ts`)

| Collection | Purpose | Key Indexes |
|---|---|---|
| `system_state` | Migrations & distributed locks | `_id` |
| `users` | Team user accounts & status | `{ email: 1 }` (unique), `{ role: 1 }` |
| `sessions` | Active user web sessions | `{ sessionIdHash: 1 }` (unique), `{ expiresAt: 1 }` (TTL), `{ userId: 1 }` |
| `api_keys` | Gateway MCP API keys | `{ keyHash: 1 }` (unique), `{ userId: 1 }`, `{ prefix: 1 }` |
| `invites` | Pending team invites | `{ tokenHash: 1 }` (unique), `{ email: 1 }`, `{ expiresAt: 1 }` (TTL) |
| `mcp_servers` | Registered upstream servers | `{ slug: 1 }` (unique), `{ enabled: 1 }`, `{ 'status.state': 1 }` |
| `tool_catalog` | Synced MCP tool catalog | `{ serverId: 1, name: 1 }` (unique), `{ exposedName: 1 }` (unique), `{ 'approval.status': 1 }`, `{ removedAt: 1 }` |
| `tool_calls` | Historical audit log of tool calls | `{ ts: 1 }` (TTL 90d), `{ userId: 1, ts: -1 }`, `{ serverSlug: 1, ts: -1 }`, `{ requestId: 1 }` |
| `admin_events` | Administrative action audit trail | `{ ts: 1 }` (TTL 90d), `{ action: 1, ts: -1 }`, `{ actorId: 1, ts: -1 }` |

---

## 6. Security Controls Status

| Security Control | Status | Implementation Details / File |
|---|---|---|
| Argon2id Password Hashing | **IMPLEMENTED** | Memory: 19 MiB, t=2, p=1, constant-time compare (`apps/gateway/src/services/password.ts`) |
| Login Lockout | **IMPLEMENTED** | Locks account after 10 failed attempts for 15 min (`apps/gateway/src/routes/auth.ts`) |
| Session Security | **IMPLEMENTED** | Random 256-bit token, SHA-256 hashed at rest, httpOnly SameSite=Lax cookie (`apps/gateway/src/services/sessions.ts`) |
| CSRF Protection | **IMPLEMENTED** | Double-submit token on state-changing requests, checked via preHandler (`apps/gateway/src/middleware/csrf.ts`) |
| API Key Scope Isolation | **IMPLEMENTED** | API keys work ONLY on `POST /mcp`; strictly rejected with 401 on all `/api/*` routes (`apps/gateway/src/middleware/authenticator.ts`) |
| Upstream Credential Encryption | **IMPLEMENTED** | AES-256-GCM, random 96-bit IV, AAD=serverId, Key ring versioning (`apps/gateway/src/registry/crypto.ts`) |
| Tool Quarantine & Hash Pinning | **IMPLEMENTED** | Tools start pending unless auto-approved; hash change triggers re-approval (`apps/gateway/src/catalog/service.ts`) |
| Leak Prevention on Tool Resolution | **IMPLEMENTED** | Denied, pending, and unknown tools all return identical `"Unknown tool"` error (`apps/gateway/src/router/tool-router.ts`) |
| CSV Formula Injection Defense | **IMPLEMENTED** | Prepends single quote `'` if cell starts with `=`, `+`, `-`, `@`, `\t`, `\r` (`apps/gateway/src/audit/redaction.ts`) |
| Kubernetes Network Isolation | **IMPLEMENTED** | Default-deny NetworkPolicies on all namespaces; strict pod-selector ingress rules (`charts/conduit/templates/netpol.yaml`) |
| Basic URL Policy | **PARTIAL** | Enforces http/https and blocks embedded credentials (`apps/gateway/src/registry/url-policy.ts`) |
| Full SSRF Protection (DNS / Private IP block) | **NOT YET** | Spec documented in `SECURITY.md §5`; scheduled for Phase 8 |
| Granular RBAC Policy Engine | **NOT YET** | Role-based (admin/member) implemented; custom parameter policies scheduled for Phase 8 |
| Distributed Rate Limiting | **PARTIAL** | Memory rate limiting in place; Redis-backed cluster rate limiting deferred to Phase 8 |
| Automated Credential Rotation Script | **NOT YET** | Manual key ring versioning supported; automated rotation worker scheduled for Phase 8 |

---

## 7. Test Suite Summary & Coverage

Total Test Files: **27** | Total Tests: **117** (100% Passing)

| Test File | Tests | Coverage Scope |
|---|---|---|
| `route-classification.test.ts` | 3 | Introspects Fastify route table: classifies 100% of routes; asserts 401 unauth, 401 API key on `/api/*`, 403 member on admin routes; asserts actorEmail contains `@` for 10 admin actions |
| `secret-leakage.test.ts` | 1 | Seeds known secrets (woo token, pepper, API key, session id); executes full lifecycle; asserts 0 secrets in response bodies or log lines |
| `stats-and-tools.test.ts` | 7 | Tests `GET /api/servers/:id/tools` (admin vs member), `POST /api/servers/:id/tools/approve`, `POST /api/servers/test`, `GET /api/config`, canonical `accept-invite`, and `GET /api/stats/servers` aggregation |
| `mcp-integration.test.ts` | 4 | Multi-instance configVersion convergence, `/mcp` auth enforcement, colliding tool names from separate servers, dead upstream isolation |
| `integration.test.ts` | 7 | Real MongoDB migrations, bootstrap idempotency, Argon2id verification, lockout after 10 failures, API key lifecycle, multi-tenant isolation |
| `team-management.test.ts` | 5 | Invite creation, single-use acceptance, self-demote/self-disable/last-admin protection, instant session & key revocation on disable |
| `route-auth.test.ts` | 20 | Table-driven matrix asserting 401 unauthenticated and 403 member on all admin routes |
| `circuit-breaker.test.ts` | 7 | State transitions (CLOSED -> OPEN -> HALF_OPEN -> CLOSED), rolling window failure counting, reset timeouts |
| `graceful-shutdown.test.ts` | 1 | Proves in-flight tool call completes and writes audit record during SIGTERM drain while `/readyz` flips to 503 |
| `tool-router.test.ts` | 6 | Namespaced routing, quarantine of unapproved tools, result size truncation at 512 KB |
| `crypto.test.ts` | 5 | AES-256-GCM encryption/decryption, AAD tampering detection, key rotation with multiple key IDs |
| `audit-sink.test.ts` | 4 | Async bounded queue buffering, batch flushing to MongoDB, drop counter under backpressure |
| `migration-0002.test.ts` | 2 | Fresh schema application and idempotent upgrade from Phase 3A legacy indexes |
| `csrf.test.ts` | 5 | Origin matching, valid token acceptance, rejection on missing or mismatched token |
| `sanitizer.test.ts` | 6 | HTML tag stripping, markdown link escaping, CSV formula injection neutralization |
| `logger-redaction.test.ts` | 3 | Pino redaction across headers, request bodies, credentials, and parameters |
| `api-keys.test.ts` | 4 | HMAC-SHA256 generation, verification against pepper, constant-time compare |
| `password.test.ts` | 3 | Argon2id hash generation, verification, password length validation |
| `sessions.test.ts` | 3 | Session token generation, SHA-256 hashing, TTL expiration |
| `roles.test.ts` | 4 | Fastify role guard middleware unit tests |
| `config.test.ts` | 4 | Configuration parsing, secret validation, encryption key string parsing |
| `woo-mcp tests` (6 files) | 26 | WooCommerce client REST mapping, product list/create/update, order management, error handling |

**What is NOT Covered Yet**:
- Live Redis failover for distributed rate limiting.
- Full DNS rebinding / SSRF custom dialer tests against AWS/GCP metadata endpoints (Phase 8).
- High-concurrency cluster load tests (1,000+ simultaneous client SSE streams).

---

## 8. Known Gaps, Risks, and Open Items

1. **In-Memory Rate Limiting**: The gateway currently applies per-replica memory throttling. In a multi-replica deployment without Redis, a client's request budget is distributed across replicas rather than shared globally.
2. **SSRF Guard Surface**: The current URL policy validates URL scheme and credentials. Full DNS resolution with private IP filtering (`169.254.169.254`, `10.0.0.0/8`, etc.) is scheduled for Phase 8.
3. **WordPress Root Process**: The upstream WordPress container starts as root before dropping privileges to `www-data` to bind port 80. While isolated behind default-deny NetworkPolicy, replacing it with `wordpress:fpm` + unprivileged nginx remains a future hardening goal.
4. **SSE Session Continuity**: The gateway runs MCP in stateless HTTP mode (`sessionIdGenerator: undefined`), which simplifies horizontal scaling behind Kubernetes round-robin but requires clients to re-negotiate if stateful sessions are desired.

---

## 9. How to Run and Demo

### Local Prerequisites
- WSL 2 (Ubuntu) with Docker Desktop, k3d, kubectl, Helm, Node.js 22+.
- Add to `/etc/hosts`: `127.0.0.1 gateway.localhost dashboard.localhost conduit.localhost`

### Execution Commands
```bash
# 1. Start local k3d cluster with Traefik and port mappings
make cluster-up

# 2. Generate random local secrets and initialize Kubernetes Secrets
make secrets

# 3. Build container images and deploy Helm releases to k3d
make deploy-local

# 4. Verify NetworkPolicy isolation (runs 6-way TCP proofs & negative control)
./scripts/test-netpol-proof.sh

# 5. Run end-to-end acceptance suite (verifies auth, /mcp tool calls, audit export, cleanup)
make e2e-gateway

# 6. Run full unit and integration test suite
npm test
```

---

## 10. Ten Key Technical Interview Questions & Model Answers

1. **How does the Gateway verify API keys on `/mcp` without storing plaintext secrets?**
   API keys use the format `mcpgw_<prefix>_<secret>`. The gateway hashes the secret using HMAC-SHA256 with a cluster pepper (`API_KEY_PEPPER`) and performs a constant-time comparison against `keyHash` in MongoDB, preventing timing attacks and database compromise leakage.

2. **Why are API keys strictly forbidden on `/api/*` endpoints?**
   To enforce least privilege and credential domain separation: API keys are machine tokens meant solely for LLM tool invocation (`POST /mcp`), whereas `/api/*` manages users, servers, and configuration, strictly requiring human session cookies and double-submit CSRF tokens.

3. **How does Conduit prevent tool enumeration or server scanning when an unapproved or quarantined tool is requested?**
   When `ToolRouter` encounters an unapproved tool, a quarantined schema change, or an unauthorized server, it returns an identical `"Unknown tool"` error as if the tool never existed, ensuring no differential timing or error leaks.

4. **How does the Circuit Breaker protect degraded upstreams from cascading failure?**
   If an upstream fails 5 consecutive requests within a rolling window, the breaker trips to `OPEN`, immediately failing incoming requests with `[gateway:circuit_open]` for 30 seconds without sending any network traffic to the struggling backend until a single probe succeeds in `HALF_OPEN`.

5. **Why is the database migration runner protected by a distributed lease?**
   Because the gateway is designed to scale horizontally across multiple replicas. A MongoDB TTL-based distributed lock on `system_state._id='migration_lock'` guarantees only one replica executes forward-only migrations at startup while other replicas wait before serving traffic.

6. **How does the Gateway protect CSV audit logs from formula injection (CSV Injection / DDE)?**
   Before rendering any user-controlled string into CSV cells, `sanitizeCsvCell` checks if the string begins with `=`, `+`, `-`, `@`, `\t`, or `\r`. If detected, it prepends a single quote (`'`), neutralizing spreadsheet formula execution.

7. **How does Conduit isolate multi-tenant audit records between team members and administrators?**
   Audit queries for non-admin members automatically inject `{ userId: principal.userId }` at the database query layer, preventing members from viewing peers' tool executions or argument payloads even with modified query parameters.

8. **What prevents an attacker who discovers an upstream server URL from accessing other cluster services via SSRF?**
   Upstream URLs are validated by `UrlPolicy`, and the cluster strictly enforces Kubernetes `NetworkPolicy` rules. Even if an admin enters an internal ClusterIP, the gateway pod's egress policy denies connections to all cluster services except designated ports on Mongo and woo-mcp.

9. **Why does Traefik require custom `ServersTransport` forwarding timeouts for the Gateway Ingress?**
   MCP uses streamable HTTP and Server-Sent Events (SSE) for tool execution streams that can take 30 to 120 seconds during complex tool operations. Custom `responseHeaderTimeout: 120s` and `readIdleTimeout: 120s` prevent the proxy from prematurely severing long-lived connections.

10. **How does the system ensure zero secret leakage in logs when upstream credentials or passwords fail?**
    Pino is configured with strict redaction paths covering `authorization`, `cookie`, `credential`, `password`, and `apiKey`. Additionally, `MongoAuditSink` redacts sensitive JSON keys and hashes raw payloads before persistence, verified by automated tests scanning 100% of captured log lines.
