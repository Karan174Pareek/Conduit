# Conduit — Architectural Standouts & Technical Highlights

Conduit was engineered from day one as a production-grade, enterprise-ready Model Context Protocol (MCP) gateway and governance platform. This document highlights key design decisions and security standouts implemented across the codebase.

---

## 1. Unified Streamable HTTP MCP Front Door

Instead of requiring individual team members to configure raw command-line subprocesses (`stdio`) with local credentials on their workstations, Conduit exposes a single **Streamable HTTP MCP endpoint** (`http://gateway.localhost/mcp`).

- **Dual Format Support**: Gracefully supports both standard JSON-RPC 2.0 HTTP POST requests and Server-Sent Events (SSE) streaming streams.
- **Dynamic Multi-Server Namespace Aggregation**: Upstream tools are automatically aggregated and namespaced (e.g. `woo__list_orders`, `notes__notes_create`, `utils__utils_calculate`), preventing collisions across diverse backends.
- **Zero Local Credential Exposure**: Client applications (Cursor, Claude Desktop, autonomous agents) only ever hold a single Conduit Bearer Token. Upstream API keys, WooCommerce consumer secrets, and database credentials never touch client machines.

---

## 2. Zero-Trust Security Architecture

### Cryptographic API Key Hashing with Pepper
- API keys follow the format `mcpgw_<prefix>_<secret>`.
- The secret token is hashed using **HMAC-SHA256 with a dedicated server-side secret pepper** (`API_KEY_PEPPER`).
- Even in the event of an unauthorized database dump, attacker pre-computed rainbow tables and dictionary attacks are completely ineffective.
- One-time reveal on key generation ensures secrets cannot be retrieved from the server or UI once dismissed.

### AES-256-GCM Credential Encryption at Rest
- Sensitive upstream server authentication credentials (e.g. Bearer tokens, HTTP basic auth headers) are encrypted at rest using **AES-256-GCM** with authenticated key identifiers (`kid`) for seamless zero-downtime key rotation.

### Enterprise Password Security with Argon2id
- User passwords are protected using the state-of-the-art **Argon2id** algorithm (RFC 9106) configured with memory-hard parameters (`m=19456`, `t=2`, `p=1`).
- Immune to GPU-accelerated cracking and ASIC attacks.

### Spreadsheet Formula Neutralization (CSV Injection Defense)
- Exporting audit logs to CSV poses a severe risk of formula injection (CWE-1236 / Excel Macro Execution) if an attacker crafts malicious tool names or input arguments starting with `=`, `+`, `-`, or `@`.
- Conduit implements automatic cell neutralization: any cell beginning with dangerous formula prefixes is automatically escaped with a leading apostrophe (`'`), neutralizing the payload before CSV compilation.

---

## 3. Autonomous Chat Agent with Safety Rails

The Conduit interactive chat agent (`/chat`) features a multi-turn tool execution engine with enterprise safety rails:

- **Schema Sanitization**: Upstream JSON schemas frequently contain keywords unsupported by frontier LLM function calling APIs (`$schema`, `additionalProperties`, `$defs`, nested `anyOf`). Conduit's schema sanitizer flattens and normalizes schemas into strict Gemini/OpenAI-compatible function declarations.
- **Infinite Loop Detection**: Autonomous agents risk entering runaway recursive execution when tools fail. Conduit actively inspects execution history: if 3 consecutive identical tool calls with identical arguments are detected, the loop is terminated immediately with an explanatory user alert.
- **Hard Turn Caps & Deadlines**:
  - Maximum of **8 tool execution iterations** per conversational turn.
  - Strict **90-second overall turn deadline**.
  - Maximum of **4 parallel tool calls** per iteration.
- **Concurrency Guard**: Strict 1-active-turn-per-user concurrency lock prevents runaway SSE connections and returns a deterministic `409 Conflict`.

---

## 4. Multi-Tenant Data Isolation at the Query Layer

Conduit enforces strict role-based access control (RBAC) and data isolation:

- **Member vs Admin Separation**:
  - Members can only issue their own API keys, view their own audit logs, and access their own chat conversations.
  - Admins govern upstream servers, invite/disable users, approve tool catalogs, and audit platform-wide activity.
- **No Reliance on Client-Side Filtering**:
  - All database queries for conversations, messages, audit logs, and keys inject `userId: principal.userId` at the database driver layer.
  - Automated tests verify that cross-tenant access attempts return strict `404 Not Found` responses, never leaking existence or metadata.

---

## 5. Cloud-Native Kubernetes Topology & Non-Root Containers

Conduit is built as a cloud-native platform deploying via Helm on `k3d` (local) and `k3s` (production VPS):

- **Non-Root Execution**:
  - Gateway and Demo MCP servers run under dedicated unprivileged users (`UID 10001 / GID 10001`) with read-only root filesystems and dropped Linux capabilities.
  - Dashboard runs via `nginx-unprivileged` on Alpine.
- **Network Policy Hardening**:
  - Kubernetes NetworkPolicies isolate namespaces and restrict ingress/egress.
  - Gateway egress is strictly restricted to Kubernetes DNS, internal MongoDB, registered upstream MCP ports (3100, 3200, 3300), and HTTPS egress to the LLM API provider.
- **High Availability & Fault Tolerance**:
  - Horizontal Pod Autoscaler (HPA) configured for Gateway CPU scaling.
  - Pod Disruption Budgets (PDB) ensure zero-downtime rolling upgrades.
  - Automatic circuit breakers and health monitors detect upstream server failures and reflect status in real time.
