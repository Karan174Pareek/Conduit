# PRD — Conduit: Team MCP Gateway + WooCommerce Hosting

Status: draft v1 · Owner: Karan · Audience: you, your AI coding tool, and the Round 2 interviewers

## 1. Summary

Conduit lets a team connect MCP servers once and use all of them through a single authenticated MCP endpoint and a chat agent. The first data source is a WooCommerce store that runs on Kubernetes, with an MCP server written from scratch. Everything runs on local Kubernetes (k3d) and deploys to a k3s VPS from the same Helm charts, with only values changes.

## 2. Goals and non-goals

**Goals**
1. Pass every item of the brief's Definition of Done, live, with two users.
2. Be production-minded: secure by default, observable, upgradeable, rollback-safe, failure-tolerant.
3. Be explainable end to end by one person: every Kubernetes resource, the MCP flow, credential movement, isolation points.
4. Treat a working core as more valuable than breadth. Stand-outs are added in value-per-hour order.

**Non-goals**
- Not a general-purpose API gateway or a multi-tenant SaaS (one organisation per deployment).
- No per-user upstream credentials (static shared credential per upstream only).
- No high availability of MongoDB or MariaDB in the local setup (documented for production).
- Model answer quality is not a goal; tool-loop correctness is.

## 3. Personas

| Persona | Needs |
|---|---|
| **Admin** (store owner / platform lead) | Register and monitor servers, invite members, issue/revoke keys, audit everything, restrict risky tools |
| **Member** (teammate) | One URL and one key for all tools in their MCP client; a chat that uses the same tools; never see upstream secrets |
| **Evaluator** (Urumi) | A system that runs from the README, a clear demo, and defensible design choices |

## 4. User stories and acceptance criteria

IDs are referenced by PHASES.md and by tests.

### Admin
- **A-1** See registered servers with status (Connected / Unreachable / Disabled) and the tools each exposes.
  *AC:* list shows status badge, last-checked time, failure reason, tool count; tool list per server; status refreshes within 20 s of a change.
- **A-2** See the WooCommerce MCP server pre-registered as the first server.
  *AC:* present after a clean `helm install` with no manual step; marked "system"; credential not editable in UI.
- **A-3** Add a server by URL + optional credential (bearer or custom header); edit, disable, remove.
  *AC:* "Test connection" before save; invalid or blocked URL gives a specific error; disable removes tools from `tools/list` within one request; remove deletes catalog and credential.
- **A-4** Invite members; issue and revoke API keys.
  *AC:* invite link single-use, expires in 72 h; revoked key is rejected on the very next call; keys listed with prefix/last-used, never the secret.
- **A-5** See an audit log of every tool call: who, server, tool, when, duration, outcome.
  *AC:* filterable by user/server/tool/outcome/time; paginated; includes calls from both MCP and chat (labelled by source); CSV export.

### Member
- **M-1** Generate my own API key.
  *AC:* shown once at creation; name + optional expiry; max 5 active keys per user.
- **M-2** Add one gateway URL + my key to Claude Code / Cursor / MCP Inspector and see tools from every enabled server.
  *AC:* works with only URL + `Authorization: Bearer`; dashboard shows copy-paste snippets for each client.
- **M-3** Use the dashboard chat with the same tools.
  *AC:* streaming answer; each tool call shown with arguments, result summary, duration; calls appear in the audit log under my name.
- **M-4** Never see or need upstream credentials.
  *AC:* no API response, log line, error message, chat transcript or audit row contains an upstream credential (verified by a test that greps responses for the seeded secret).

## 5. Functional requirements

### 5.1 Store (FR-ST)
- FR-ST-1 WordPress + WooCommerce + MariaDB on Kubernetes, persistent volumes for DB and `wp-content`.
- FR-ST-2 Fully automated first-run setup (core install, WooCommerce activation, COD enabled, permalinks, sample currency/timezone, REST key) via a Helm hook Job; idempotent.
- FR-ST-3 Storefront reachable at `http://shop.<domain>`; checkout works with COD.
- FR-ST-4 Admin at `/wp-admin`; admin password from a Secret.

### 5.2 WooCommerce MCP server (FR-WM)
- FR-WM-1 Written from scratch, MCP over Streamable HTTP.
- FR-WM-2 Tools: `list_products`, `create_product`, `list_orders`, `get_order`, `update_order_status` (required). Extras: `get_product`, `update_product`, `sales_summary`.
- FR-WM-3 ClusterIP only; NetworkPolicy allows ingress only from the gateway pods; additionally requires a bearer token.
- FR-WM-4 Talks to the store via the REST API; the rationale is documented.
- FR-WM-5 Inputs validated (zod); outputs trimmed to essential fields; honest annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

### 5.3 Gateway (FR-GW)
- FR-GW-1 Registry CRUD for upstream servers (Streamable HTTP), optional static credential (bearer or named header), encrypted at rest.
- FR-GW-2 Single MCP endpoint `POST /mcp`: `initialize`, `tools/list`, `tools/call`, `ping`.
- FR-GW-3 Aggregation of tools from all enabled, healthy, approved servers; calls routed by the exposed name.
- FR-GW-4 Collision handling by `<slug>__<tool>` namespacing (documented, tested with two servers that both expose `ping`).
- FR-GW-5 Per-upstream timeouts, circuit breaker, bulkhead; a dead upstream never blocks listing or calls to others.
- FR-GW-6 Upstream credentials never leave the server side.
- FR-GW-7 At least three upstreams: woo-mcp + two demo servers (notes, utils).
- FR-GW-8 Health checking with reason strings; status derived and stored.
- FR-GW-9 Tool-definition pinning and admin approval (stand-out).

### 5.4 Team and access (FR-TM)
- FR-TM-1 Roles: `admin`, `member`. Bootstrap admin from a Secret on first start.
- FR-TM-2 Per-user API keys, hashed, revocable, with expiry and last-used tracking.
- FR-TM-3 Audit row for every tool call (success, error, timeout, denied, unreachable, rate-limited) and for admin actions.
- FR-TM-4 Dashboard login with email + password (argon2id), server-side sessions, CSRF protection.
- FR-TM-5 Tool permissions: per-role and per-user allow/deny by server and tool; hidden from the list and rejected on call (stand-out).

### 5.5 Chat agent (FR-CH)
- FR-CH-1 Gemini function calling loop through the gateway's `ToolRouter`, max 8 iterations per turn.
- FR-CH-2 Acts as the logged-in user; audit `source = chat`.
- FR-CH-3 Streams events (SSE): text deltas, tool call, tool result, error, done.
- FR-CH-4 Conversations persisted per user; private to that user.
- FR-CH-5 LLM key in a Secret; never sent to the browser.
- FR-CH-6 Many-tools mode: search-then-execute meta-tools when the catalog is large (stand-out).

### 5.6 Platform (FR-K8S)
- FR-K8S-1 Helm only; `values-local.yaml` and `values-prod.yaml`.
- FR-K8S-2 Everything in-cluster. Ingress for storefront, dashboard, gateway.
- FR-K8S-3 Readiness, liveness (and startup where slow) probes and requests/limits on every workload.
- FR-K8S-4 Secrets in Kubernetes Secrets only; none in Git or values files.
- FR-K8S-5 Default-deny NetworkPolicies with explicit allows; non-root, read-only-rootfs containers where feasible (documented exceptions).
- FR-K8S-6 Documented local domain approach; documented VPS values diff; `helm upgrade --atomic` and `helm rollback` procedure.

### 5.7 Bonus: multi-store provisioning (FR-MS) — only after core is solid
Create/delete stores from the dashboard; one namespace per store; automatic MCP registration with tool names that name the store; clean teardown; NetworkPolicy isolation; ResourceQuota + LimitRange; max stores per user; provisioning timeout; retry-safe and restart-safe reconciliation. Test: "compare today's orders across two stores", delete one, its tools and resources are gone.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | `tools/list` p95 < 200 ms (served from cache); gateway overhead on `tools/call` p95 < 50 ms excluding upstream time |
| Availability | One dead upstream: others unaffected. Gateway restart: back in < 15 s, no manual step |
| Scalability | Gateway runs with 2+ replicas and no sticky sessions (stateless endpoint) |
| Security | See SECURITY.md; no secret in logs, images, Git or API responses |
| Observability | JSON logs with request IDs; Prometheus metrics; per-server reasons for failure |
| Operability | One command to create the cluster, one to install, one to run the e2e check |
| Portability | Only Helm values differ between k3d and k3s |
| Maintainability | Typed codebase, lint + unit + integration + e2e tests in CI, `helm lint` and `helm template` validation in CI |

## 7. Definition of Done traceability

| Brief DoD item | Stories / requirements | Verified by |
|---|---|---|
| Storefront add-to-cart + COD checkout; order in WP admin | FR-ST-1..4 | Manual + Playwright smoke |
| Agent (user A) creates product with name and price; appears on storefront | M-3, FR-WM-2, FR-CH-1 | e2e script + manual |
| Place order by hand; agent lists today's orders | FR-WM-2, FR-CH-1 | e2e script + manual |
| User B connects external client with URL + key; sees all tools; same orders question | M-2, FR-GW-2/3 | e2e (MCP SDK client) + MCP Inspector |
| One prompt needing two upstreams | FR-GW-3, FR-GW-7 | e2e with Woo + notes tools |
| Revoke B's key; next call rejected | A-4, FR-TM-2 | e2e |
| Disable one upstream; tools vanish from chat and client | A-3, FR-GW-3 | e2e |
| Kill an upstream pod; others work; dashboard shows Unreachable | FR-GW-5/8 | e2e with `kubectl delete pod` |
| Every call in audit log under the right user | A-5, FR-TM-3 | e2e asserts on audit API |

## 8. Scope tiers

- **Tier 1 (must)**: everything in section 5 except stand-out items and 5.7.
- **Tier 2 (should)**: tool permissions, SSRF guard, credential encryption, tool pinning, metrics, upgrade/rollback documentation, VPS deployment with TLS, rate limits.
- **Tier 3 (could)**: many-tools meta-tools, multi-replica proof, multi-store provisioning, hosted MCP servers by image, OAuth on the gateway.

Cut order if behind schedule: OAuth → hosted servers → multi-store → many-tools → rate limits → the rest of Tier 2 stays.

## 9. Assumptions and open questions

- Assumption: one admin bootstraps from a Secret; additional admins are promoted by an admin.
- Assumption: email delivery is out of scope; invites are copy-paste links (optional SMTP later).
- Assumption: Gemini free tier is enough for the demo; the model name is configurable.
- Open: do you want the two extra upstreams to be your own small servers (recommended: full control and a safe "malicious server" demo) or a public remote server as well? Both can coexist.
- Open: confirm the deadline date to fix the day numbers in PHASES.md.

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WooCommerce setup automation is fiddly | Blocks everything downstream | Phase 1 first; spike REST auth early (README spikes 1–2) |
| WSL2 networking, port 80, `*.localhost` | Lost hours | Decide the domain/port approach in Phase 0 and document it |
| Gemini free-tier rate limits during demo | Flaky demo | Retry/backoff, short prompts, record a backup take |
| Scope creep from stand-outs | Unfinished core | Tier gates in PHASES.md; do not start Tier 3 until the e2e passes |
| Unexplainable AI-written code | Fails Round 2 | Per-phase "explain-it-back" sessions (PROMPTS.md section 4) |

## 11. Glossary

**Upstream**: an MCP server registered in the gateway. **Exposed name**: the namespaced tool name clients see. **Principal**: the authenticated actor (user via key or session). **Pinning**: storing an approved hash of each tool definition. **Quarantine**: tool hidden until re-approved because its definition changed or is new.
