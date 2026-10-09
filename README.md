# Conduit — Team MCP Gateway + WooCommerce Hosting on Kubernetes

Conduit is a production-grade team MCP (Model Context Protocol) gateway paired with automated WooCommerce hosting on Kubernetes.

It allows teams to connect and govern upstream MCP servers behind a single authenticated, audited, and policy-governed MCP endpoint and interactive chat agent.

## Documentation Index

The canonical specifications and design documents live in [`docs/`](docs/):

| Document | Purpose |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product scope, user stories, personas, functional requirements, and Definition of Done traceability |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System components, sequence flows, Kubernetes topology, Helm chart architecture, and design tradeoffs |
| [docs/DATABASE.md](docs/DATABASE.md) | MongoDB collections, indexing strategy, TTL retention, and state machines |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, trust boundaries, credential handling, SSRF defense, and Kubernetes hardening checklist |
| [docs/ERROR_HANDLING.md](docs/ERROR_HANDLING.md) | Error taxonomy, timeouts/deadlines, circuit breaker & bulkhead rules, and retries |
| [docs/PHASES.md](docs/PHASES.md) | 14-day implementation plan, phase-by-phase deliverables, exit criteria, and demo script |
| [docs/PROMPTS.md](docs/PROMPTS.md) | Chat agent prompts, meta-tools definitions, and interview review prompts |
| [docs/README.md](docs/README.md) | Original brief notes, spikes, and conventions |

---

## Environment & Prerequisites

- **Host OS**: Windows with WSL2 (Docker Desktop installed with WSL integration enabled).
- **Node.js**: v22+ (TypeScript strict mode, npm workspaces).
- **Cluster**: `k3d` locally, `k3s` on production VPS.
- **Package Management**: Helm charts only (`charts/conduit`, `charts/woocommerce-store`).

### Local Domains & Port Mapping

- **Domains**: Ingress routes services on `*.localhost`:
  - `dashboard.localhost` -> Gateway Web UI
  - `gateway.localhost` -> Stateless Streamable HTTP MCP Front Door (`/mcp`)
  - `shop.localhost` -> WooCommerce Storefront & WP Admin
- Modern web browsers natively resolve `*.localhost` to `127.0.0.1`.
- For CLI/Node tools, entries can be mapped in `hosts` or configured via `global.domain=127.0.0.1.nip.io`.
- **Port 80**: Bound directly to the k3d load balancer (`80:80@loadbalancer`). If port 80 is occupied, set `global.publicPort=8080`.

---

## Quickstart (Phase 0)

1. **Install dependencies and run tests**:
   ```bash
   npm install
   npm run test
   ```

2. **Generate local development secrets**:
   ```bash
   ./scripts/gen-secrets.sh
   ```

3. **Start local cluster (once Docker Desktop is running)**:
   ```bash
   make cluster-up
   ```

4. **Verify throwaway ingress**:
   ```bash
   curl http://whoami.localhost
   ```
