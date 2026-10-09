# Conduit — Team MCP Gateway + WooCommerce Hosting on Kubernetes

> "Conduit" is a working name. Rename freely.
> Target: Urumi AI FDE Internship, Round 1. Goal: a production-grade build, not a demo-grade one.

## Document map

| File | Purpose | Read when |
|---|---|---|
| [PRD.md](PRD.md) | What we build and why: scope, user stories, requirements, acceptance criteria, DoD traceability | Before anything else |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, flows, Kubernetes topology, Helm layout, API surface, tradeoffs | Before writing code or charts |
| [DATABASE.md](DATABASE.md) | MongoDB collections, indexes, retention, migrations, state machines | Before the gateway data layer |
| [SECURITY.md](SECURITY.md) | Controls, threat model (the 4 required topics), hardening checklist | Before auth work, and again before the demo |
| [ERROR_HANDLING.md](ERROR_HANDLING.md) | Error taxonomy, timeouts, circuit breaker, retries, user-facing behaviour | Before the upstream manager and chat loop |
| [PHASES.md](PHASES.md) | 14-day plan, per-phase deliverables and exit tests, cut line, demo script | Daily |
| [PROMPTS.md](PROMPTS.md) | Chat-agent system prompt, meta-tool text, and prompts to drive your AI coding tool | When building, and when preparing for the interview |

## Decision log (keep this; the interview will ask "why?")

| # | Decision | Why |
|---|---|---|
| D-01 | npm-workspaces monorepo, TypeScript everywhere | One language, shared types (tool/principal/error schemas), matches your MERN strength |
| D-02 | k3d on WSL2 locally, k3s on the VPS | Same distribution both places. k3s ships Traefik, local-path storage and an NetworkPolicy controller. Kind's default CNI does not enforce NetworkPolicies, which would break the isolation demo |
| D-03 | Official images (`mariadb`, `mongo`, custom WordPress) instead of Bitnami charts | Fewer moving parts, and no dependency on Bitnami catalogue availability, which has been changing |
| D-04 | WordPress image with WooCommerce **baked in** | Deterministic installs, no internet needed at runtime, faster provisioning, egress can be denied |
| D-05 | One `woocommerce-store` chart (WordPress + MariaDB + woo-mcp) | Used for the first store now and for every provisioned store in the bonus |
| D-06 | woo-mcp talks to the store over the WooCommerce REST API through the in-cluster Service | Scoped key, no exec into pods, works with any store; WP-CLI would need pod exec rights |
| D-07 | Gateway MCP endpoint is **stateless** Streamable HTTP | Horizontal scaling with no sticky sessions or shared session store |
| D-08 | Exposed tool name is `<serverSlug>__<tool>` | Collision-proof, routable, fits the 64-char / `[A-Za-z0-9_-]` limits of common clients and Gemini |
| D-09 | Tools of Disabled / Unreachable / Quarantined servers are hidden from `tools/list` | Honest state for the model; dashboard still shows cached catalog |
| D-10 | Chat agent calls the same in-process `ToolRouter` as the MCP endpoint, as the logged-in user | Same auth, policy, pinning, audit and metrics path; no minted long-lived key |
| D-11 | API keys: random, shown once, stored as HMAC-SHA256 with a server pepper. Dashboard sessions: server-side, httpOnly cookie | Revocable, no secrets in DB, no JWT-revocation problem |
| D-12 | No secret ever in Git or in `values-*.yaml`. Charts take `existingSecret`; `make secrets` creates them from a git-ignored `.env` | Satisfies "no hardcoded secrets" literally, and the VPS uses the same mechanism |
| D-13 | Gateway readiness depends on MongoDB only, never on upstreams | A dead upstream must not take the gateway out of rotation |
| D-14 | Tool-definition pinning: new or changed upstream tool definitions are quarantined until an admin approves | Defence against tool-poisoning and "rug-pull" upstreams |
| D-15 | Upstream credentials encrypted at rest with AES-256-GCM, key from a Secret, key-id versioned | Stand-out #6, cheap to do early |
| D-16 | Gemini via `@google/genai`, model name from config | Free tier; the brief grades the tool loop, not the answers |

## Spikes: verify these on day 1–3 before relying on them

These are details I am not certain about from memory. Each is small, but each can burn a day.

1. **WooCommerce REST auth over plain HTTP in-cluster.** WooCommerce only accepts Basic auth with consumer key/secret when it believes the request is HTTPS. Plan: woo-mcp sends `X-Forwarded-Proto: https` and WordPress is configured to trust it (standard reverse-proxy `wp-config.php` snippet). Confirm, or fall back to Application Passwords plus a one-line mu-plugin.
2. **Consumer-key insertion by the setup Job.** Plan: the key/secret are generated outside the cluster (in the Secret), and the Job inserts the hashed key into `wp_woocommerce_api_keys` using WooCommerce's own hashing function. Confirm the column set for your WooCommerce version.
3. **MCP TypeScript SDK API** for stateless Streamable HTTP server and client transports. Pin the SDK version and read its current README; names and options have moved between releases.
4. **Claude Code / Cursor config syntax** for remote HTTP MCP servers with a bearer header. Check the current docs and paste the exact snippet in your README.
5. **Gemini current free-tier model names, rate limits, and function-calling schema support** (whether `parametersJsonSchema` is accepted or you need the schema sanitizer). Also check the data-use terms for the free tier: do not demo with real customer data.
6. **Windows specifics:** whether port 80 is free for k3d's load balancer; how `*.localhost` resolves from Node/CLI tools on Windows (browsers handle it, other tools may not; fall back to hosts-file entries or an nip.io domain via `global.domain`).

## Conventions used across all docs

- **Slug**: `[a-z][a-z0-9-]{1,30}`, no `__`. Unique per upstream server.
- **Exposed tool name**: `<slug>__<toolName>`; if over 64 chars, truncate the tool part and append `_` + 6 hex chars of a hash.
- **Principal**: `{ userId, role, via: "apikey"|"session", keyId?, source: "mcp"|"chat" }`.
- **Request ID**: every inbound request gets `x-request-id`, logged and stored in the audit row.
- **Namespaces**: `conduit-system` (platform), `store-default` (first store), `store-<id>` (bonus stores).
- **Hosts (local)**: `dashboard.localhost`, `gateway.localhost`, `shop.localhost` (all from `global.domain`).
