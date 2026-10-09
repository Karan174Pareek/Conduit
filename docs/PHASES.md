# PHASES — 14-day build plan

Rules of the plan:
- Every phase ends with something you can **demo and test**. Do not start the next phase on a red exit test.
- **Core (Phases 0–7) must be done by day 9.** Everything after is value-per-hour ordered. The brief says a working core beats an unfinished bonus.
- After each phase: commit, tag (`phase-N`), update the README section, and do the **explain-it-back** session (PROMPTS.md §4). That is what protects you in Round 2.
- If you are behind, use the cut list in §13. Do not cut tests, security basics, or docs.

Day numbers are relative to the start; adjust when you confirm the deadline.

## Overview

| Phase | Days | Theme | Tier |
|---|---|---|---|
| 0 | 1 | Foundations: repo, cluster, tooling, secrets, CI skeleton | Core |
| 1 | 2–3 | WooCommerce on Kubernetes (chart, setup Job, storefront, COD) | Core |
| 2 | 3–4 | woo-mcp server + its chart | Core |
| 3 | 4–6 | Gateway core: registry, upstream manager, MCP front door, keys, audit | Core |
| 4 | 6–7 | Dashboard: auth, servers, team, keys, audit | Core |
| 5 | 7–8 | Chat agent (Gemini tool loop, SSE, trace) | Core |
| 6 | 8–9 | Two more upstreams, collisions, DoD e2e script | Core |
| 7 | 9 | Production hardening of the core: probes, limits, netpol, security contexts, metrics | Core |
| 8 | 10–11 | Stand-outs batch 1: policy, SSRF, encryption, pinning, rate limits, observability | Should |
| 9 | 11–12 | VPS deployment on k3s, TLS, upgrade and rollback proof | Should |
| 10 | 12–13 | Many-tools mode, multi-replica proof, then multi-store bonus (as far as it gets) | Could |
| 11 | 13–14 | Docs, threat model, demo video, buffer | Core |

Realistic note: Phase 10's multi-store provisioning is big. Treat it as optional and time-boxed to roughly one day; a clean partial (create + register + delete for one extra store, with NetworkPolicies) beats a broken full version, but only attempt it if the e2e passes and Phase 9 is done.

---

## Phase 0 — Foundations (Day 1)

**Goal:** a reproducible dev environment and a repo that CI can build.

Tasks
1. Install on WSL2: Docker Desktop (WSL integration on), `kubectl`, `helm`, `k3d`, Node 22, `make`, `jq`. Clone and work **inside the WSL filesystem** (not `/mnt/c`) for file-watch and I/O speed.
2. `scripts/cluster-up.sh`: `k3d cluster create conduit --servers 1 -p "80:80@loadbalancer" --k3s-arg "--disable=metrics-server@server:0"` (keep Traefik; keep metrics-server if you want `kubectl top`). Decide port 80 vs 8080 now and record it.
3. Monorepo skeleton (npm workspaces, TS project references, ESLint, Prettier, Vitest), `packages/shared` with error codes and zod types.
4. `Makefile`: `cluster-up`, `cluster-down`, `build`, `load` (k3d image import), `secrets`, `install`, `upgrade`, `uninstall`, `e2e`, `lint`, `test`.
5. `scripts/gen-secrets.sh` + `.env.example` (never real values; `.env` git-ignored). Creates all Kubernetes Secrets with random internal values.
6. CI (GitHub Actions): install, lint, typecheck, unit tests, build images, `helm lint`, `helm template` on both values files, Trivy scan.
7. Domain approach: write the "Local domains" README section and test one `*.localhost` URL end to end from the browser and from `curl` inside WSL.

Exit test: `make cluster-up && make test` green; `curl http://whoami.localhost` (throwaway deployment) returns through Traefik.

## Phase 1 — WooCommerce on Kubernetes (Days 2–3)

**Goal:** a real store, persistent, installed with zero manual steps.

Tasks
1. `images/wordpress/Dockerfile`: base `wordpress:<pinned>-apache`, add WooCommerce plugin (pinned version, downloaded at build), WP-CLI, a mu-plugin for reverse-proxy HTTPS trust and application defaults.
2. `charts/woocommerce-store`: MariaDB StatefulSet + PVC, WordPress Deployment (Recreate) + PVC, Services, Ingress (`shop.<domain>`), ConfigMap for non-secret config, Secrets by reference.
3. `setup-job.yaml` as a Helm post-install/post-upgrade hook: wait for DB → `wp core install` (or detect installed) → activate WooCommerce → set permalinks, currency, timezone → enable COD, disable other methods → create a sample product → insert the REST consumer key from the Secret → write a "setup complete" option. All idempotent.
4. `WP_HOME` / `WP_SITEURL` from `global.domain` + port; resource requests/limits; startup/readiness/liveness probes.
5. Spike (README spikes 1–2): confirm REST Basic auth works from inside the cluster with `X-Forwarded-Proto: https`.

Exit tests
- `helm install` on a clean cluster ends with a working storefront; add to cart and checkout with COD; order visible in `/wp-admin`.
- `kubectl delete pod` WordPress and MariaDB: data still there (PVC).
- `helm upgrade` is a no-op the second time (idempotent job).
- `curl` with the consumer key from a debug pod returns products JSON.

Explain-it-back topics: PVC lifecycle, StatefulSet vs Deployment, why Recreate strategy, hook Jobs, startup probe.

## Phase 2 — woo-mcp (Days 3–4)

**Goal:** a clean MCP server for the store, reachable only from the gateway.

Tasks
1. `apps/woo-mcp`: stateless Streamable HTTP, bearer auth, zod schemas, 5 required tools + `get_product`, `update_product`, `sales_summary`, annotations, trimmed outputs, `/healthz` `/readyz`.
2. Unit tests with a mocked REST layer + one smoke test against the real store.
3. Chart templates in `woocommerce-store`: Deployment, ClusterIP Service, NetworkPolicy (allow only from gateway pods in `conduit-system`), Secret refs, probes, limits, non-root security context.
4. Test with MCP Inspector via `kubectl port-forward` (dev only) to list and call tools.

Exit tests
- Inspector can call all five required tools against the live store.
- From a random pod, `curl woo-mcp:3100` times out (NetworkPolicy); without the bearer token the server returns 401.
- `list_orders` with `date_preset=today` respects `STORE_TIMEZONE`.

## Phase 3 — Gateway core (Days 4–6)

**Goal:** the MCP front door and the machinery behind it, tested without a UI.

Tasks (in this order)
1. Config, logging (pino + redaction), Mongo connection, migrations runner, `/healthz` `/readyz`.
2. Users, bootstrap admin, sessions (minimal), API keys (generate, hash, verify, revoke).
3. Registry CRUD + encryption + `configVersion` + seed Job for `woo` (trusted).
4. `UpstreamManager`: connect, health loop, breaker, bulkhead, catalog cache, timeouts, result cap. Test against fake upstreams (slow, hung, garbage, flapping).
5. Naming and `ToolRouter` (list/call), pinning (trusted auto-approve), error mapping.
6. MCP front door (`POST /mcp`, stateless), authenticator, Origin check.
7. Audit queue and `tool_calls` writes; `GET /audit`.
8. Chart `conduit`: gateway Deployment/Service/Ingress, Mongo StatefulSet, migration Job, seed Job, NetworkPolicies, Secrets by reference.

Exit tests
- MCP Inspector with `Authorization: Bearer` key sees `woo__*` tools and calls `woo__list_orders`.
- Kill woo-mcp: list still returns (without woo tools), call returns `[gateway:...]` error in < timeout; recovery automatic.
- Revoked key → 401 on the next call.
- Audit rows exist with the right user, server, tool, duration, outcome.
- Unit and integration suites green in CI.

Explain-it-back topics: how a call travels end to end, why stateless, why hide tools, breaker states, key hashing.

## Phase 4 — Dashboard (Days 6–7)

**Goal:** everything an admin and a member need in the UI.

Tasks
1. Vite + React + TS, router, API client (`ApiError`), auth context, CSRF.
2. Pages: Login, Accept invite, Servers (list, status, tools, add/edit/disable/remove, test connection), Team (invite, roles, disable), Keys (create/revoke, one-time reveal modal), Audit (filters, pagination, CSV), Connect (gateway URL + client snippets).
3. Role-aware navigation; members see read-only server list.
4. nginx-unprivileged image, chart templates, Ingress (`/` → dashboard, `/api` → gateway).
5. Accessibility basics and empty/loading/error states.

Exit tests
- Admin invites user B (copy link), B sets password, B creates a key, B connects Inspector.
- Admin disables server → status "Disabled", tools vanish from the list.
- Member cannot see admin pages (UI and API both enforce).
- Playwright smoke: login → add server → see tools → create key → audit shows a call.

## Phase 5 — Chat agent (Days 7–8)

**Goal:** a working tool loop in the dashboard as the logged-in user.

Tasks
1. Gemini adapter (`@google/genai`), schema sanitiser, tool declaration builder from `ToolRouter.list(principal)`.
2. Loop with iteration cap, deadlines, parallel call cap, retries (429/5xx), truncation, repeat-call detection.
3. SSE endpoint and chat UI: streaming text, collapsible tool-call cards (name, server, args, duration, status).
4. Persistence: conversations/messages; title generation.
5. System prompt from PROMPTS.md with current date/time and timezone injected each turn.
6. Mock-Gemini tests for the loop.

Exit tests
- User A: "create a product Test Mug at 12.50" → appears on the storefront.
- Place an order by hand; "what orders came in today?" returns it.
- Audit rows show `source=chat` and user A.
- Gemini 429 simulated → clear message, no crash.

## Phase 6 — Extra upstreams and the DoD script (Days 8–9)

**Goal:** three upstreams, collisions proven, the whole definition of done automated.

Tasks
1. `demo-notes-mcp` (`add_note`, `list_notes`, `search`, `delete_note`, `ping`) and `demo-utils-mcp` (`current_time`, `calculate`, `convert_units`, `search`, `ping`); in-memory or tiny PVC; bearer auth; chart templates; seeded in the gateway as trusted.
2. `apps/demo-rogue-mcp` for the threat demo (off by default).
3. Two-server prompts: for example "create a product and save a note about it" (woo + notes), "what time is it in the store timezone and what orders came in since 9am".
4. `scripts/e2e/dod.ts`: uses the MCP SDK client as user B and the REST API as admin/user A to execute: create users and keys, call tools, place an order via WC REST (or Playwright), revoke key, disable server, kill pod (`kubectl`), assert audit rows. Runs in CI against a k3d cluster in a nightly job.

Exit tests
- `make e2e` passes on a clean cluster in under 10 minutes.
- Collision demo: `notes__ping` and `utils__ping` and `woo__ping` all listed, routed correctly.

**Core complete. Tag `core-complete`. Record a rough backup demo video now** (you will redo it at the end, but this is insurance).

## Phase 7 — Production hardening of the core (Day 9)

Tasks
- Probes tuned and verified (kill and slow-start tests); requests/limits tuned from `kubectl top`; PDB and HPA templates (off locally).
- Pod security contexts (restricted) on all conduit-owned workloads, WordPress exception documented; PSS namespace labels.
- Default-deny NetworkPolicies + the allow matrix; `scripts/netpol-proof.sh`.
- `automountServiceAccountToken: false`, dedicated ServiceAccounts.
- Metrics endpoint + a Grafana-free minimal view (dashboard stats page) and optional ServiceMonitor.
- Graceful shutdown, `terminationGracePeriodSeconds`, `preStop`.
- `helm lint`, `helm template | kubeconform`, and `kube-linter` or `kubescape` run in CI.
- Backup CronJobs (Mongo + MariaDB) and a restore drill written in the README.

Exit tests: netpol proof passes; `kubectl get pods` all ready; killing the gateway pod during an external client loop recovers with at most a few failed requests; scanners report no critical findings.

## Phase 8 — Stand-outs batch 1 (Days 10–11)

Order (stop when time is up):
1. **Tool permissions** (policy collection, evaluation, UI, hidden + rejected). Demo: members can `list_orders`, cannot `create_product` / `update_order_status`.
2. **SSRF guard** + table-driven tests.
3. **Credential encryption at rest** + rotation script.
4. **Tool pinning / approvals** + rogue demo (poisoned description, rug-pull).
5. **Rate limits** per key/user (memory first, Redis optional).
6. **Observability**: metrics wired, per-server error rate and reasons in the dashboard.
7. **Upgrade/rollback** drill with a real change (bump gateway image, break it deliberately, `helm rollback`).

Exit tests: each item has an automated test from SECURITY.md §10.

## Phase 9 — VPS deployment (Days 11–12)

Tasks
1. VPS with k3s (`curl -sfL https://get.k3s.io | sh -`), firewall (80/443/22 only), non-root SSH.
2. DNS A records for `dashboard.`, `gateway.`, `shop.` on a domain you control; cert-manager + Let's Encrypt `ClusterIssuer`.
3. Push images to GHCR; imagePullSecret if private.
4. Secrets: SOPS/age or create manually; document names; enable k3s secrets encryption.
5. `helm upgrade --install --atomic -f values-prod.yaml`; run the e2e subset against the public URLs.
6. Document the exact values diff (table in ARCHITECTURE §9) and the rollback.

Exit tests: public HTTPS storefront, dashboard, MCP endpoint with Inspector from your laptop; `helm rollback` demonstrated.

## Phase 10 — Many-tools, scaling proof, multi-store (Days 12–13)

Order:
1. **Many-tools mode** (search + execute meta-tools, threshold). Quick win.
2. **Two gateway replicas proof**: scale to 2, kill one under load, clients keep working; show per-replica limiter vs Redis.
3. **Multi-store bonus** only if 1–2 are done. Minimum viable: provisioner service with RBAC; create a store from the dashboard (namespace, quota, secrets, helm install, wait, register); delete cleanly; NetworkPolicies; max stores; timeout; restart recovery.
   Test from the brief: compare today's orders across two stores; delete one; its tools and namespace are gone.

## Phase 11 — Docs, video, buffer (Days 13–14)

Tasks
1. README (local setup, VPS setup, place an order, connect Claude Code/Cursor/Inspector, use chat, run e2e, troubleshooting for WSL2).
2. "System design and tradeoffs" note (condense ARCHITECTURE §1, §5, §15) and "Threat model" note (SECURITY §2).
3. Stand-out/bonus list with file pointers.
4. Demo video (script below). Rehearse twice; record a single clean take with a prepared fresh cluster. Keep a backup recording.
5. Submit via the form; double-check repo is public/accessible and contains no secrets (`gitleaks` run).

---

## 12. Demo video script (target 12–15 minutes)

| Min | Segment | Show |
|---|---|---|
| 0–1 | Intro | One architecture slide (the mermaid system diagram), components and responsibilities |
| 1–3 | Kubernetes | `kubectl get ns,pods,pvc,ingress,networkpolicy`, Secrets by name only, requests/limits, probes in a manifest, what is public vs internal, netpol proof |
| 3–5 | Store | Storefront → add to cart → COD checkout → order in WP admin |
| 5–8 | Chat as user A | Create product by prompt → on storefront; order by hand → "orders today?" → trace cards → audit shows user A, `source=chat` |
| 8–11 | External client as user B | Inspector/Claude Code with URL + key → tools of all servers → orders question → two-server prompt |
| 11–13 | Control | Revoke B's key (rejected) → disable a server (tools vanish in both) → delete a pod (unreachable, others fine) → audit log |
| 13–14 | Security | Key hashing, encrypted credentials, SSRF block demo, rogue server pinned/quarantined, what a member cannot do |
| 14–15 | Prod story | `values-local` vs `values-prod` diff, VPS URL, `helm upgrade` and `helm rollback`, stand-outs list |

Pre-flight checklist: fresh cluster; Gemini key valid and quota available; two users and keys created in advance but B's key creation shown; fake customer data only; browser zoom and font large; terminal font large; `scripts/demo-reset.sh` to restore state.

## 13. Cut list (in order) if behind

1. OAuth (do not start)
2. Hosted MCP servers by image (do not start)
3. Multi-store provisioning
4. Redis-backed shared rate limits
5. Many-tools mode
6. VPS TLS polish (keep a plain-HTTP VPS if needed)
7. Metrics beyond the dashboard stats page

Never cut: the DoD flow, probes/limits/netpol basics, secrets handling, hashed keys, audit, timeouts and breaker, README, threat model, tests that guard the above.

## 14. Definition of done for each phase

A phase is done when: code merged with tests, chart(s) lint and template, README section updated, exit tests pass on a clean cluster, `phase-N` tag created, and you have explained the phase out loud without notes.
