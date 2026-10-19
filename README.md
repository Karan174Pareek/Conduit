# Conduit — Team MCP Gateway + WooCommerce on Kubernetes

Conduit is a production-grade **Team Model Context Protocol (MCP) Gateway** paired with automated WooCommerce hosting on Kubernetes. It enables organizations to securely connect, govern, rate-limit, and audit upstream MCP microservices behind a unified, zero-trust HTTP front door and autonomous AI chat agent.

```
                   +-------------------------------------------------------+
                   |                 Client Applications                   |
                   |   Claude Code  |  Cursor  |  Web UI  | MCP Inspector  |
                   +-------------------------------------------------------+
                                              |
                                              | Bearer mcpgw_<prefix>_<secret>
                                              v
+------------------------------------------------------------------------------------------+
|  Kubernetes Ingress (Traefik) - TLS Termination, HSTS, Rate Limiting, CORS               |
+------------------------------------------------------------------------------------------+
       |                                      |                                   |
       | /api, /mcp                           | / (UI)                            | (Storefront)
       v                                      v                                   v
+-----------------------------+     +-------------------+     +----------------------------+
|  conduit-gateway (Fastify)  |     | conduit-dashboard |     | store-default (WooCommerce)|
|  - Authenticator & Tokens   |     | (Vite / React)    |     | - WordPress 6.7.2 Apache   |
|  - SSRF Guard (Custom Agent)|     +-------------------+     | - MariaDB 11 StatefulSet   |
|  - Policy Engine (§5.6)     |                               | - woo-mcp (REST adapter)   |
|  - ToolRouter & Sanitizer   |                               +----------------------------+
|  - Rate Limiter & Audit     |
|  - Chat Agent (Gemini/Fake) |
+-----------------------------+
       |                  |
       v                  v
+----------------+  +----------------------------------------------------------------------+
| MongoDB        |  | Internal MCP Microservices (conduit-system)                          |
| - Users & Keys |  | - notes-mcp (Shared Team Notes with Atomic PVC Storage)              |
| - Audit & TTL  |  | - utils-mcp (Deterministic AST Math Sandbox, Zero eval/Function)     |
+----------------+  +----------------------------------------------------------------------+
```

---

## 1. Documentation Index

Detailed specifications and architectural guides live in [`docs/`](docs/):

| Document | Description |
|---|---|
| [docs/STANDOUTS.md](docs/STANDOUTS.md) | Verified architectural highlights, code citations, and test names |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Formal threat model, four required topics, and production hardening changes |
| [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) | Deep-dive architecture choices, routing, circuit breakers, and bulkhead design |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Secret rotation playbooks, disaster recovery restore drill, scaling, and incident response |
| [docs/DEPLOY_VPS.md](docs/DEPLOY_VPS.md) | Single-node k3s VPS production setup, cert-manager, GHCR secrets, and local vs. prod table |
| [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md) | Timed 12–15 minute video recording script with exact terminal commands and UI actions |
| [docs/PRD.md](docs/PRD.md) | Product scope, user personas, requirements, and Definition-of-Done criteria (§7) |
| [docs/SECURITY.md](docs/SECURITY.md) | Security controls, credential handling, and Kubernetes hardening checklist |

---

### 1.1 Architectural Rationale: WooCommerce REST API vs. WP-CLI
Conduit interfaces with the WooCommerce store via its authenticated REST API (`woo-mcp` adapter) rather than invoking `wp-cli` command-line binaries or executing shell commands inside the WordPress container:
- **Zero Pod-Exec RBAC**: The gateway and `woo-mcp` require zero Kubernetes `pods/exec` permissions. Workloads run with `automountServiceAccountToken: false` and strict network policies.
- **Hook & Event Preservation**: The WooCommerce REST API triggers the full WordPress lifecycle (order stock reductions, webhooks, customer transactional emails, tax calculations), which direct CLI or SQL manipulation bypasses.
- **Microservice Decoupling & Portability**: `woo-mcp` is an independent, stateless microservice. The same architecture operates identically whether WooCommerce runs in-cluster or on external managed hosting.
- **Concurrency & Failure Isolation**: REST calls are multiplexed across Apache worker processes with standard keepalive, timeouts, and circuit-breaker bulkheads, avoiding heavy PHP process fork storms under concurrent agent queries.

---

## 2. Environment Setup & Prerequisites

### 2.1 Host Requirements
- **Operating System**: Windows 11 with WSL2 (Ubuntu 24.04 LTS).
- **Runtime**: Node.js 22 LTS, npm 10+.
- **Containers & Cluster**: Docker Desktop with WSL2 integration, `k3d` v5+, `kubectl`, `helm` v3.14+.
- **Testing Tools**: Playwright browser binaries (`npx playwright install chromium`).

### 2.2 Local Domain Resolution (`/etc/hosts`)
Conduit uses `*.localhost` domains routed via Traefik Ingress:
- `dashboard.localhost` -> Team Management & Chat Dashboard
- `gateway.localhost` -> Stateless Streamable HTTP MCP Front Door (`/mcp`, `/api`)
- `shop.localhost` -> WooCommerce Storefront & WP Admin

Add these static entries to both hosts files:
- **Windows** (`C:\Windows\System32\drivers\etc\hosts` as Administrator):
  ```hosts
  127.0.0.1 dashboard.localhost gateway.localhost shop.localhost
  ::1       dashboard.localhost gateway.localhost shop.localhost
  ```
- **WSL2** (`/etc/hosts`):
  ```hosts
  127.0.0.1 dashboard.localhost gateway.localhost shop.localhost
  ::1       dashboard.localhost gateway.localhost shop.localhost
  ```

---

## 3. Quickstart & Makefile Targets

### 3.1 Bootstrap Cluster from Zero
```bash
# 1. Install workspace dependencies
npm install

# 2. Generate cryptographically random local secrets (.env)
./scripts/gen-secrets.sh

# 3. Create k3d cluster with multi-port ingress mapping
make cluster-up

# 4. Synchronize Kubernetes secrets from .env
make secrets

# 5. Build and deploy all local components (Gateway, Dashboard, Store, Upstreams)
make deploy-local
```

### 3.2 Key Makefile Target Catalog
| Target | Description |
|---|---|
| `make cluster-up` | Provisions local k3d cluster with load balancer on port 80/443 |
| `make cluster-down` | Deletes local k3d cluster and cleans up resources |
| `make secrets` | Provisions `conduit-secrets` and `store-secrets` in Kubernetes from `.env` |
| `make deploy-local` | Deploys `conduit` and `woocommerce-store` charts to the cluster |
| `make test` | Executes full Vitest suite in parallel against an isolated throwaway Docker MongoDB |
| `make typecheck` | Validates TypeScript compilation across all workspace packages (`tsc --noEmit`) |
| `make e2e-dod` | Runs the full PRD §7 Definition of Done automated verification suite (9 rows) |
| `make e2e-gateway` | Comprehensive HTTP MCP protocol, SSE streaming, and resilience suite |
| `make e2e-ui` | Automated Playwright browser smoke tests against dashboard and storefront |

---

## 4. First Login & Password Change

In accordance with enterprise security policy, fresh cluster deployments flag the bootstrap admin with `mustChangePassword: true`. All platform API calls are blocked with HTTP 403 `password_change_required` until updated.

1. Retrieve the bootstrap admin credentials:
   ```bash
   # Email: admin@conduit.localhost
   kubectl get secret conduit-secrets -n conduit-system \
     -o jsonpath="{.data.BOOTSTRAP_ADMIN_PASSWORD}" | base64 -d | cut -c1-4 && echo "***"
   ```
2. Navigate to **[http://dashboard.localhost](http://dashboard.localhost)**.
3. Sign in with the retrieved password.
4. You will be redirected to `/change-password`. Set a new compliant password (minimum 12 characters, checked against common denylists).
5. Upon submission, all legacy sessions are revoked, an immutable `admin_event` is logged, and the dashboard unlocks.

---

## 5. Placing a Storefront Order

WooCommerce runs natively inside the cluster (`shop.localhost`):
1. Open **[http://shop.localhost](http://shop.localhost)** in your browser.
2. Select any product in the catalog and click **Add to cart**.
3. Proceed to **Checkout** (`http://shop.localhost/checkout/`).
4. Fill in billing details, select **Cash on delivery (COD)**, and click **Place order**.
5. The order is immediately processed and visible in WordPress Admin (`http://shop.localhost/wp-admin`) and queryable via the MCP Gateway.

---

## 6. Team Governance & API Key Issuance

1. **Invite Members**:
   - In the Dashboard, navigate to **Team** (`/team`) and click **Invite Member**.
   - Enter the member's email and select their role (`member` or `admin`).
   - Copy the single-use invite link (`/accept-invite?token=...`) valid for 72 hours.
2. **Issue Member API Keys**:
   - As a member, navigate to **Account > API Keys** (`/keys`).
   - Click **Create API Key** and assign a descriptive label.
   - **One-Time Secret Reveal**: Copy the token (`mcpgw_<prefix>_<secret>`). The secret is hashed with HMAC-SHA256 and `API_KEY_PEPPER` before storing; it is never viewable again.

---

## 7. Connecting External MCP Clients

Conduit provides a single **Streamable HTTP MCP Front Door** (`http://gateway.localhost/mcp`). Client tools authenticate with their Conduit Bearer Token.

### 7.1 Claude Code
Add Conduit using the CLI or direct configuration:
```bash
claude mcp add conduit http://gateway.localhost/mcp \
  --header "Authorization: Bearer mcpgw_YOUR_KEY_HERE"
```
Or in `~/.claude.json`:
```json
{
  "mcpServers": {
    "conduit": {
      "type": "http",
      "url": "http://gateway.localhost/mcp",
      "headers": {
        "Authorization": "Bearer mcpgw_YOUR_KEY_HERE"
      }
    }
  }
}
```

### 7.2 Cursor IDE
1. Open **Cursor Settings** > **Features** > **MCP**.
2. Click **+ Add New MCP Server**.
3. Configure the server:
   - **Type**: `http` (or `sse`)
   - **Name**: `conduit`
   - **Server URL**: `http://gateway.localhost/mcp`
   - **Headers**:
     ```json
     {
       "Authorization": "Bearer mcpgw_YOUR_KEY_HERE"
     }
     ```
4. Save and verify that aggregated tools appear with green status indicators.

### 7.3 MCP Inspector
Inspect and interact with tools using the official Model Context Protocol Inspector:
```bash
npx @modelcontextprotocol/inspector
```
In the Inspector web interface:
- **Transport Type**: `Streamable HTTP` (or `SSE`)
- **URL**: `http://gateway.localhost/mcp`
- **Custom Header**: `Authorization: Bearer mcpgw_YOUR_KEY_HERE`
- Click **Connect** to explore aggregated tools across WooCommerce, Notes, and Utils.

---

## 8. Interactive AI Chat Agent & Governance

Conduit features a conversational AI agent (`/chat`) capable of autonomous planning and multi-upstream tool orchestration:
- **Streaming Responses**: Token streaming powered by Server-Sent Events (SSE).
- **Destructive Tool Confirmation Gate**: In accordance with production values (`chat.confirmDestructive: true`), mutating operations (e.g. `woo__create_product`, `woo__update_order_status`) present an interactive **Approve / Deny** prompt before execution.
- **Multi-Server Workflows**: The agent can autonomously coordinate actions across services (e.g. creating a WooCommerce product and logging a team note in `notes-mcp` within a single conversation turn).

---

## 9. Automated Testing & Verification

Conduit enforces rigorous automated test coverage:

```bash
# 1. Parallel Unit & Integration Tests (Throwaway Docker MongoDB)
make test

# 2. PRD §7 Definition of Done Verification (Real Playwright + Live Cluster)
make e2e-dod

# 3. Gateway MCP Protocol Verification (SSE, Tools, Bulkheads, Limits)
make e2e-gateway

# 4. Playwright Browser E2E UI Smoke Test
make e2e-ui
```

---

## 10. Upgrades, Rollbacks & VPS Production

### 10.1 Upgrades & Atomic Rollback
Deploy updates with Helm using the `--atomic` flag to ensure automatic rollback on failure:
```bash
helm upgrade conduit charts/conduit \
  --namespace conduit-system \
  --values charts/conduit/values.yaml \
  --atomic \
  --timeout 180s
```
Manual rollback to a prior revision:
```bash
helm rollback conduit <REVISION_NUMBER> -n conduit-system
```

### 10.2 Production VPS Deployment
For deploying on a public single-node Linux VPS using k3s, Let's Encrypt TLS via cert-manager, firewall rules, and container registries, consult the comprehensive guide in [`docs/DEPLOY_VPS.md`](docs/DEPLOY_VPS.md).

---

## 11. Troubleshooting

| Symptom | Probable Cause | Diagnostic & Resolution |
|---|---|---|
| `curl: (6) Could not resolve host` | Missing `*.localhost` entry in `/etc/hosts` | Ensure `127.0.0.1 gateway.localhost dashboard.localhost shop.localhost` is present in both Windows and WSL `/etc/hosts`. |
| Upstream server shows `unreachable` | Pod failure or SSRF allowlist mismatch | Check `kubectl get pods -n conduit-system`. Verify target host matches `SSRF_ALLOWLIST_HOSTS` in Helm config. |
| HTTP 403 `password_change_required` | Bootstrap admin forced password policy | Sign in via Web UI at `dashboard.localhost` and update password at `/change-password`. |
| Playwright test timeout | Storefront initial page load or block checkout | Ensure WooCommerce coming soon mode is disabled (`wp option update woocommerce_coming_soon 'no'`). |
