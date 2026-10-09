# ERROR HANDLING

Rules first, details after.

1. **A failing upstream degrades only itself.** Listing and calls to other servers are unaffected.
2. **Every failure has a stable code, a human message, and a request ID.** No raw stack traces or upstream internals reach clients.
3. **Never retry a non-idempotent call automatically.** `tools/call` is not retried after the request may have reached the upstream. Retries are limited to connection establishment and to read-only health/list operations.
4. **Fail fast, bounded everywhere.** Every I/O has a deadline; every queue and buffer has a cap.
5. **Tell the model the truth.** Tool failures are returned as tool results the model can reason about (`isError: true`), not as a broken session.
6. **Audit never lies and never blocks.** Failures are audited with their outcome; audit trouble degrades observability, not availability (unless fail-closed is configured).

## 1. Error taxonomy

Codes live in `packages/shared/errors.ts` and are used by the gateway, dashboard and tests.

| Code | Layer | Meaning | HTTP (REST) | MCP behaviour | Audit outcome |
|---|---|---|---|---|---|
| `auth_missing` / `auth_invalid` | front door | No or bad key/session | 401 | HTTP 401 + `WWW-Authenticate: Bearer` | (counted in metrics; not a tool-call row) |
| `auth_revoked` / `auth_expired` / `user_disabled` | front door | Key revoked/expired or owner disabled | 401 (same body as invalid) | same as above | – |
| `forbidden` | REST | Role lacks permission | 403 | – | – |
| `csrf_failed` | REST | Missing/bad CSRF token | 403 | – | – |
| `validation_failed` | REST/MCP | Input fails schema | 422 with field errors | JSON-RPC `-32602` | `invalid` |
| `tool_unknown` | router | Unknown, denied or quarantined tool (indistinguishable) | – | JSON-RPC `-32602` "Unknown tool" | `denied` / `quarantined` (internal detail kept in the row) |
| `rate_limited` | front door / router | Per-key or per-user limit | 429 + `Retry-After` | HTTP 429 (request level) or tool result `isError` | `rate_limited` |
| `upstream_disabled` | router | Server disabled between list and call | – | tool result `isError` | `denied` |
| `upstream_unreachable` | upstream | Connect/DNS/TLS failure | – | tool result `isError` | `unreachable` |
| `circuit_open` | upstream | Breaker open; failing fast | – | tool result `isError` with retry hint | `unreachable` |
| `upstream_busy` | upstream | Bulkhead full | – | tool result `isError` | `error` |
| `upstream_timeout` | upstream | Deadline exceeded | – | tool result `isError`; upstream cancelled | `timeout` |
| `upstream_auth_failed` | upstream | Upstream returned 401/403 to the gateway | – | tool result `isError` (generic text; details admin-only) | `error` |
| `upstream_protocol_error` | upstream | Invalid JSON-RPC, SSE garbage, wrong content type | – | tool result `isError` | `error` |
| `upstream_tool_error` | upstream | Upstream returned `isError` result | – | passed through, text sanitised | `error` (`upstreamIsError: true`) |
| `result_too_large` | upstream | Response over cap | – | tool result `isError` | `error` |
| `ssrf_blocked` | registry/upstream | URL or resolved IP not allowed | 422 on save; status reason at runtime | – | – |
| `internal_error` | any | Bug | 500 | JSON-RPC `-32603` | `error` |
| `llm_unavailable` / `llm_rate_limited` / `llm_bad_request` | chat | Gemini problems | 200 stream with `error` event (or 502/429 before stream starts) | – | – |

**Message style for tool-result errors** (what the model and user read):
`[gateway:upstream_unreachable] The "woo" server is not responding (connection refused). Other servers are unaffected. Try again shortly or ask an admin.`
Prefix `[gateway:<code>]` lets the model and the UI recognise gateway-originated failures versus the upstream's own errors.

## 2. Timeouts and deadlines (defaults, all in config)

| Operation | Default | Notes |
|---|---|---|
| Upstream connect | 3 s | Includes DNS + TLS + MCP initialize |
| `tools/list` from upstream | 3 s | Background refresh only; request path serves cache |
| `tools/call` | 30 s (per server up to 120 s) | `AbortSignal` passed down; on timeout send MCP cancellation, then drop |
| Health `ping` | 2 s | Every 15 s with jitter |
| woo-mcp → WordPress | 10 s | One per REST call |
| Gateway inbound request | 125 s hard cap | Ingress read timeout slightly higher |
| Chat turn | 90 s total | Per Gemini request 30 s; per tool call uses the tool's own deadline |
| Graceful shutdown | 30 s drain, 60 s pod grace | |

Deadline propagation: the router computes `deadline = min(callTimeout, remainingTurnBudget)` and passes it down, so a chat turn near its limit does not start a call it cannot finish.

## 3. Circuit breaker and bulkhead

- **Closed** → counts consecutive failures (connect error, timeout, protocol error; upstream tool-level `isError` does **not** count).
- **Open** after 3 failures: calls fail immediately with `circuit_open`; tools hidden from `tools/list`. Open time 10 s, ×2 each re-open, cap 60 s, ±20 % jitter.
- **Half-open**: exactly one probe (the health `ping`), success → closed and catalog refresh; failure → open with the larger backoff.
- **Status mapping**: `open` → dashboard `Unreachable` with `reasonCode` + last error time.
- **Bulkhead**: `maxConcurrent` per upstream (default 8); extra calls fail with `upstream_busy` immediately (no unbounded queue).
- **Slow-loris/hang**: because every call has a deadline and a bulkhead slot is released on timeout, a hanging upstream cannot exhaust gateway capacity.

## 4. Failure scenarios and required behaviour

| Scenario | Expected behaviour | How to test |
|---|---|---|
| woo-mcp pod killed | Within one health interval or first failed call: `Unreachable`; other servers fine; recovery automatic when pod returns; tools reappear without admin action | e2e: `kubectl delete pod`, assert notes tools still work, assert dashboard status, assert recovery |
| Upstream hangs (accepts, never answers) | Call returns `upstream_timeout` at deadline; list unaffected; breaker opens after 3 | Test server with `sleep` tool |
| Upstream returns garbage | `upstream_protocol_error`; breaker counts it | Test server returning HTML |
| Upstream returns 401 | `upstream_auth_failed`; dashboard reason "Credential rejected"; no credential in text | Test server requiring token |
| Upstream returns 200 MB | Aborted at cap, `result_too_large` | Test server streaming |
| Two upstreams expose the same tool | Both listed with distinct prefixes; calls route correctly | Unit + e2e (`ping`) |
| Tool removed upstream between list and call | Upstream returns unknown tool → mapped to `tool_unknown`; catalog refreshed | Test server |
| Member key revoked mid-session | Next request 401; in-flight call completes but is audited | e2e |
| Server disabled during in-flight call | In-flight call finishes (or times out); new calls blocked; tools gone from list | e2e |
| MongoDB down | `/readyz` fails (pod unready, traffic drained); `/healthz` stays OK (no restart storm); existing in-memory catalog not used to authenticate (auth needs DB) → 503 | Integration test killing Mongo |
| MongoDB slow | Auth/DB calls have 2 s deadlines; return 503 with `Retry-After` | Chaos test |
| Audit insert fails | Rows retried with backoff from a bounded queue; after max retries logged to stderr as JSON and counted in `gateway_audit_dropped_total`; with `AUDIT_FAIL_CLOSED=true` and queue unhealthy, new calls are refused (503) | Unit test with failing writer |
| Gateway SIGTERM | Readiness fails first, stop accepting, drain, flush audit, close upstreams | Integration test |
| Config change on another replica | Converges ≤ ~5 s via `configVersion` polling | Two-instance test |
| Gemini 429/5xx | Retry up to 3 times honouring `retryDelay`, with jitter; then show a clear message in chat | Mock Gemini |
| Gemini returns a malformed function call | Return a structured error as the function response once; if repeated, end the turn with an explanation | Mock Gemini |
| Model loops on tools | Stop at 8 iterations or on identical repeated calls (3×) with an explanatory message | Mock Gemini |
| Browser disconnects mid-chat | Abort controller cancels the turn and any in-flight upstream calls; partial assistant message saved with `interrupted: true` | Manual + test |

## 5. Retries (the only ones allowed)

| Where | What | Policy |
|---|---|---|
| Upstream connect | establish MCP session | 1 immediate retry, then breaker logic |
| Upstream `tools/list` and `ping` | idempotent | per health loop only |
| woo-mcp → WordPress | `GET` only, connection errors/5xx | max 2, 200 ms × 2 backoff, jitter |
| Gemini | rate-limit / 5xx | max 3, exponential, honour provider delay |
| Audit writes | DB insert | exponential backoff up to 5 attempts |
| `tools/call` | **never** automatically | surface the error; the user or model decides |

`create_product` and `update_order_status` are therefore never replayed by the gateway. For convenience, woo-mcp's `create_product` may accept an optional `client_reference` stored as a product meta key so a caller can check for an existing product before retrying.

## 6. Dashboard behaviour

- A single `ApiError` type (`code`, `message`, `requestId`, `fieldErrors`) from the API client.
- React error boundary per page; toast for recoverable errors, inline field errors for 422.
- 401 → redirect to login preserving the return path; 403 → "You don't have access" page; network failure → persistent banner with retry.
- Every error toast shows the request ID (copy button) so a bug report is traceable in logs and audit.
- Optimistic updates only for harmless toggles; server state re-fetched on error.
- Server cards show `reasonCode` as plain text (for example "Connection refused", "Credential rejected", "Timed out") and `lastSuccessAt`.
- Chat UI: tool failures render in the trace as red items with the gateway code; the assistant text continues if the model handled it; a "Retry" button re-sends the last user turn.

## 7. Logging and metrics for errors

- One structured log line per failed call: `level=warn`, `requestId`, `userId`, `serverSlug`, `tool`, `code`, `durationMs`; message text is scrubbed for credentials.
- Metrics: `gateway_tool_calls_total{outcome}`, `gateway_upstream_failures_total{server,code}`, `gateway_circuit_state{server}`, `gateway_timeouts_total{server}`.
- Suggested alerts (prod runbook): circuit open > 5 min; error rate > 20 % over 10 min; audit drops > 0; Mongo unready; Gemini 429 rate high.

## 8. Startup and dependency ordering

- Gateway starts even if upstreams are down (it just marks them `Unreachable`).
- Gateway refuses to start (clear single-line error, non-zero exit) on: missing required secret, malformed `CREDENTIAL_ENC_KEYS`, schema version too low.
- Helm ordering: Mongo → migration Job (pre-install/upgrade hook) → gateway → seed Job. Store: MariaDB → WordPress → setup Job (post-install hook) → woo-mcp readiness gates on the store being reachable.
- Setup Job: `backoffLimit: 6`, `activeDeadlineSeconds: 600`, every step idempotent (`wp core is-installed` checks, upsert of the consumer key), failures print the failing step and reason to the Job log; the Helm install uses `--atomic --timeout 10m` so a failed install rolls back cleanly.

## 9. Provisioner errors (bonus)

| Failure | State result | Behaviour |
|---|---|---|
| Quota exceeded (max stores per user) | request rejected, 409 | No resources created |
| Helm timeout / failed rollout | `failed`, `failure.code=helm_timeout` | Release rolled back (`--atomic`); namespace kept for inspection until the user deletes or retries |
| Provisioner restarts mid-way | On boot reconciler resumes if inside the deadline, else `failed` with `reason=interrupted_timeout` | Idempotent steps, lease prevents double-driving |
| Registration with the gateway fails | `failed`, `failure.code=register_failed` | Retry safe; store resources remain |
| Delete during provisioning | `deleting` takes precedence; steps cancelled | Teardown order enforced |
| Namespace stuck terminating | `deleting` with finalizer diagnostics in the failure reason after 5 min | Operator hint in the message |

## 10. Test plan for this document

- **Unit**: breaker state machine; timeout and cancel; name mapping with collisions and truncation; error mapping table; schema sanitiser; audit queue overflow.
- **Integration** (Docker, real Mongo, in-process fake upstreams): slow, hanging, garbage, huge, 401, flapping upstreams; two replicas converging; Mongo outage.
- **E2E (cluster)**: kill pod, revoke key, disable server, restart gateway during a chat turn.
- **Contract**: woo-mcp tools against a real WooCommerce (smoke) and against a recorded fixture (fast).
