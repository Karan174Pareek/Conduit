# Development Log — Conduit

## Phase 5 & 6 DoD Completion Notes

### Phase 5 Chat Agent & Interactive Loop
- Implemented `ChatService` turn loop with Gemini 2.5 Flash client (`@google/genai`) and streaming SSE.
- Schema sanitizer strips unsupported JSON Schema keywords (`$schema`, `additionalProperties`, `$defs`) and flattens unions into strict LLM function declarations.
- Infinite loop prevention halts turns if 3 consecutive identical tool calls are detected.
- Hard turn deadline of 90s, max 8 tool execution iterations, and 4 parallel calls per iteration.
- Multi-user isolation enforced: conversations and message history strictly scoped to authenticated user ID.

### Phase 6 Extra Upstream Servers & Definition-of-Done
- Deployed Demo Notes MCP (`port 3200`) and Demo Utils MCP (`port 3300`) as lightweight distroless non-root services (`UID 10001`).
- Implemented Demo Rogue MCP (`port 3400`) canary for prompt injection and schema validation testing.
- Created automated `scripts/e2e/dod.ts` covering all 11 criteria in the master Definition of Done.
- All 11 DoD criteria verified passing with automated test suite (`make e2e-dod`).
- Gateway resilience verified with 16-step flow (`make e2e-gateway`).
- Dashboard UI smoke verified with Playwright (`make e2e-ui`).

## Known Issues & Notes
- **Local Unit Test Database Isolation**: Integration tests running against the in-cluster MongoDB via `127.0.0.1:27017` port-forward use the provisioned `conduit` user. MongoDB user `conduit` is scoped with `readWrite` on the `conduit` database. Test suites dynamically creating separate databases (`conduit_test_*`) require either standalone unauthenticated MongoDB instances or using the `conduit` database with collection-level test prefixing.

## Phase 2 & Security Notes

### TODO: Phase 7 — Evaluate WordPress Non-Root Container Architecture
- **Context**: The current `images/wordpress/Dockerfile` is based on the official `wordpress:6.7.2-apache` image, which starts as `root` (UID 0) to bind port 80 before setuid-ing to `www-data` (UID 33). This requires a documented exception for Trivy misconfiguration rule `DS-0002` in `.trivyignore.yaml` and [docs/SECURITY.md §7](SECURITY.md).
- **Phase 7 Hardening Evaluation**:
  - Investigate running WordPress completely non-root:
    1. Option A: Custom Apache configuration binding port 8080 as `www-data` directly without starting as root.
    2. Option B: `wordpress:fpm` coupled with `nginx-unprivileged` sidecar in the same pod.
  - Test performance, file permissions on `wp-content` PVC mounts, and compatibility with the automated setup hook (`wp core install`).
