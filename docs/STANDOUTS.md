# Conduit — Architectural Standouts & Technical Highlights

This document details verified, production-ready security and architectural standouts implemented across Conduit. Every feature listed here is actively running in the codebase, with citations to exact source files and automated test suites.

---

## 1. Full Multi-Layer SSRF Defense Guard
- **Source Files**: 
  - Implementation: [`apps/gateway/src/registry/ssrf.ts`](file:///home/karan/conduit/apps/gateway/src/registry/ssrf.ts), [`apps/gateway/src/registry/secure-fetch.ts`](file:///home/karan/conduit/apps/gateway/src/registry/secure-fetch.ts)
  - Helm Configuration: [`charts/conduit/templates/configmap.yaml`](file:///home/karan/conduit/charts/conduit/templates/configmap.yaml)
- **Verified Test**: 
  - `apps/gateway/tests/ssrf.test.ts` (`SSRF Protection (Full RFC/Bogon/DNS Rebind Suite)`)
- **Technical Capabilities**:
  - **DNS Resolution Pre-Validation**: Uses custom lookup to resolve IP addresses before dialing; validates against IPv4/IPv6 private ranges, loopbacks (`127.0.0.0/8`, `::1`), link-local including cloud metadata (`169.254.169.254`, `fe80::/10`), Carrier-Grade NAT (`100.64.0.0/10`), multicast (`224.0.0.0/4`, `ff00::/8`), and IPv4-mapped IPv6 (`::ffff:127.0.0.1`).
  - **DNS Rebinding & Decimal/Octal IP Defense**: Converts non-standard IP notations (hex, octal, single-integer) into canonical IP strings prior to range evaluation.
  - **Direct Pinning & Redirect Prohibition**: Custom Undici Agent dials directly to the validated IP, passing the original `Host` header to prevent DNS rebinding TOCTOU attacks. HTTP redirects are strictly disabled (`maxRedirections: 0`).
  - **In-Cluster First-Party Allowlist**: Configurable via `SSRF_ALLOWLIST_HOSTS` in Helm, permitting only explicitly registered in-cluster microservices (`*.conduit-system.svc.cluster.local`, `*.store-default.svc.cluster.local`).

---

## 2. Fine-Grained Tool Permissions Policy Engine (§5.6)
- **Source Files**:
  - Policy Engine: [`apps/gateway/src/auth/policy-engine.ts`](file:///home/karan/conduit/apps/gateway/src/auth/policy-engine.ts)
  - Tool Router Enforcement: [`apps/gateway/src/registry/tool-router.ts`](file:///home/karan/conduit/apps/gateway/src/registry/tool-router.ts)
- **Verified Test**:
  - `apps/gateway/tests/policies-and-rate-limits.test.ts` (`Tool Permissions Engine (§5.6) > enforces read-only shortcut: member can call list_orders, cannot call create_product/update_order_status`, `honours evaluation order: user deny > user allow > role deny > role allow`)
- **Technical Capabilities**:
  - **Strict Evaluation Order**: Evaluates permissions via deterministic hierarchy: `User Deny` > `User Allow` > `Role Deny` > `Role Allow` > `Members Read-Only Shortcut` > `Default Allow`.
  - **Information-Leaking Attack Prevention**: When a tool is forbidden for a member, it is completely hidden from `tools/list`. If invoked directly via `tools/call`, it returns the exact same `"Unknown tool"` error as a non-existent tool, preventing attackers from probing internal API surfaces.
  - **Read-Only Shortcut**: Built-in regex classification automatically restricts members to safe operations (`list_*`, `get_*`, `read_*`, `view_*`, `calculate`, etc.) while blocking mutations (`create_*`, `update_*`, `delete_*`, `write_*`).

---

## 3. High-Performance Token Bucket Rate Limiting & Concurrency Guard
- **Source Files**:
  - Rate Limiter Middleware: [`apps/gateway/src/middleware/rate-limit.ts`](file:///home/karan/conduit/apps/gateway/src/middleware/rate-limit.ts)
  - Gateway Setup: [`apps/gateway/src/app.ts`](file:///home/karan/conduit/apps/gateway/src/app.ts)
- **Verified Test**:
  - `apps/gateway/tests/policies-and-rate-limits.test.ts` (`F2 c) Rate Limiting & Concurrency > enforces token bucket rate limiter and reports retry-after seconds`, `enforces concurrency cap per user`)
- **Technical Capabilities**:
  - **Token Bucket Algorithm**: Configurable burst capacity and leak rate per user and per API key, returning `429 Too Many Requests` with a compliant `Retry-After` header.
  - **Concurrency Guard**: Limits simultaneously executing MCP and chat requests per user, preventing resource starvation attacks across gateway replicas.
  - **IP-Based Authentication Throttling**: Protects sensitive endpoints (`/api/auth/login`, `/api/auth/accept-invite`, `/api/auth/change-password`) against credential stuffing and brute force attempts.

---

## 4. Zero-Downtime Credential Encryption Key Rotation
- **Source Files**:
  - Cryptographic Primitives: [`apps/gateway/src/crypto.ts`](file:///home/karan/conduit/apps/gateway/src/crypto.ts)
  - Key Rotation Script: [`dev/rotate-credentials.ts`](file:///home/karan/conduit/dev/rotate-credentials.ts)
- **Verified Test**:
  - `apps/gateway/tests/policies-and-rate-limits.test.ts` (`F2 d) Credential Re-Encryption Rotation Drill > re-encrypts server credentials from old key to new active key idempotently`)
- **Technical Capabilities**:
  - **Key Identifiers (KID)**: Encrypted payloads serialize the active `kid` with the AES-256-GCM ciphertext, IV, and auth tag (`kid:iv:ciphertext:tag`).
  - **Zero-Downtime Migration**: The gateway can decrypt credentials using any previously known key in `CREDENTIAL_ENC_KEYS` while encrypting new credentials with the primary active key.
  - **Idempotent CLI Rotation**: `dev/rotate-credentials.ts` inspects all registered MCP servers, decrypts credentials with their matching legacy key, and re-encrypts them with the new primary key in an atomic MongoDB batch.

---

## 5. Bootstrap Forced Password Change & Session Lifecycle
- **Source Files**:
  - Auth Routes: [`apps/gateway/src/routes/auth.ts`](file:///home/karan/conduit/apps/gateway/src/routes/auth.ts)
  - Authenticator: [`apps/gateway/src/auth/authenticator.ts`](file:///home/karan/conduit/apps/gateway/src/auth/authenticator.ts)
  - Frontend Pages: [`apps/dashboard/src/pages/ChangePasswordPage.tsx`](file:///home/karan/conduit/apps/dashboard/src/pages/ChangePasswordPage.tsx), [`apps/dashboard/src/pages/AccountPage.tsx`](file:///home/karan/conduit/apps/dashboard/src/pages/AccountPage.tsx)
- **Verified Test**:
  - `apps/gateway/tests/password.test.ts` (`POST /api/auth/change-password`)
  - `dev/e2e/dod.ts` (`Row 1: Admin bootstrap password change`)
- **Technical Capabilities**:
  - **Enforced Quarantine State**: Newly seeded bootstrap admins have `mustChangePassword: true`. All API endpoints (except `POST /api/auth/change-password`, `GET /api/auth/me`, and `POST /api/auth/logout`) respond with HTTP 403 `password_change_required`.
  - **Strict Password Policy**: Rejects passwords under 12 characters and screens against common denylist passwords.
  - **Global Session Revocation**: Successfully changing the password revokes all active sessions for the user and logs an immutable `admin_event`.

---

## 6. Real First-Party Microservices Architecture
- **Source Files**:
  - Notes MCP: [`apps/notes-mcp/src/server.ts`](file:///home/karan/conduit/apps/notes-mcp/src/server.ts)
  - Utils MCP: [`apps/utils-mcp/src/server.ts`](file:///home/karan/conduit/apps/utils-mcp/src/server.ts), [`apps/utils-mcp/src/calculate.ts`](file:///home/karan/conduit/apps/utils-mcp/src/calculate.ts)
- **Verified Tests**:
  - `apps/utils-mcp/tests/calculate.test.ts` (`calculate parser & security tests`)
  - `dev/e2e/dod.ts` (`Row 5: Coordinated operations across notes-mcp and utils-mcp with audit tracking`)
- **Technical Capabilities**:
  - **Shared Team Notes (`notes-mcp`)**: Stateful microservice mounting a persistent volume (`/data`). Implements atomic writes (`write to tmp + fsync + rename`), size and note count quotas, and strict schema validation.
  - **Deterministic Math Engine (`utils-mcp`)**: Stateless microservice implementing a recursive-descent math AST parser. Zero use of JavaScript `eval()` or `Function()`, impervious to prototype pollution or code injection.

---

## 7. Tool Schema Sanitizer & Hidden Unicode Defense
- **Source Files**:
  - Implementation: [`apps/gateway/src/registry/schema-sanitizer.ts`](file:///home/karan/conduit/apps/gateway/src/registry/schema-sanitizer.ts)
- **Verified Test**:
  - `apps/gateway/tests/schema-sanitizer.test.ts` (`strips dangerous unicode and validates tool parameters`)
- **Technical Capabilities**:
  - **Zero-Width & BiDi Override Neutralization**: Strips invisible Unicode characters (`\u200B`, `\u200C`, `\u200D`, `\uFEFF`) and bidirectional control markers (`\u202A`–`\u202E`, `\u2066`–`\u2069`) that could disguise malicious prompt injections in tool descriptions.
  - **JSON Schema Strictness**: Sanitizes upstream tool descriptions, limits string lengths, and ensures downstream LLMs receive unambiguous tool definitions.

---

## 8. Definition of Done End-to-End Test Suite
- **Source File**: [`dev/e2e/dod.ts`](file:///home/karan/conduit/dev/e2e/dod.ts)
- **Command**: `make e2e-dod`
- **Verified Traceability**:
  - All 9 rows of `docs/PRD.md §7` verified live against the Kubernetes cluster.
  - Real Playwright browser automation for storefront ordering.
  - External MCP client verification via standard JSON-RPC HTTP over Bearer token.
  - Pod failure isolation and automated recovery verification.
  - Complete multi-tenant isolation audit check (zero cross-user leakage).
