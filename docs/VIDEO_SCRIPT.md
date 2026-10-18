# Conduit — Complete 12–15 Minute Video Walkthrough Script

This script provides an exact, minute-by-minute operational walkthrough for recording or presenting the Conduit Team MCP Gateway and WooCommerce platform on Kubernetes.

---

## 1. Quick Access Reference & Credentials

| Service | Local URL | Role / Credentials |
|---|---|---|
| **Conduit Dashboard** | [http://dashboard.localhost](http://dashboard.localhost) | Admin: `admin@conduit.localhost` / (Kubernetes Secret) |
| **Gateway MCP Front Door** | [http://gateway.localhost/mcp](http://gateway.localhost/mcp) | Bearer Token: `Authorization: Bearer mcpgw_<prefix>_<secret>` |
| **WooCommerce Storefront** | [http://shop.localhost](http://shop.localhost) | Public shop checkout & product catalog |
| **WordPress Admin** | [http://shop.localhost/wp-admin](http://shop.localhost/wp-admin) | Store Admin: `admin` / Password from `store-secrets` |

---

## 2. Minute-by-Minute Demonstration Script

### [00:00 – 02:00] Overview, Architecture & Mandatory Password Change
- **Narration**:
  *"Welcome to Conduit. Conduit is an enterprise-grade Team MCP Gateway and WooCommerce hosting platform built natively for Kubernetes. It unifies disparate upstream Model Context Protocol servers behind a single secure HTTP front door, enforcing zero-trust credential isolation, fine-grained tool policies, audit attribution, and SSRF defenses."*
- **Action**:
  1. Retrieve the bootstrap admin password:
     ```bash
     kubectl get secret conduit-secrets -n conduit-system \
       -o jsonpath="{.data.BOOTSTRAP_ADMIN_PASSWORD}" | base64 -d | cut -c1-4 && echo "***"
     ```
  2. Open browser at `http://dashboard.localhost`. Log in with `admin@conduit.localhost`.
  3. Notice immediate redirect to `/change-password` with alert: `Password change required before accessing platform`.
  4. Submit a new compliant password (`Conduit2026!Enterprise`).
  5. The dashboard unlocks and displays healthy cluster metrics.

---

### [02:00 – 04:30] Upstream Microservices, Tool Approvals & Policy Engine
- **Narration**:
  *"In Conduit, developers and autonomous agents never receive direct credentials to databases or third-party APIs. Upstream microservices connect via Streamable HTTP inside the cluster."*
- **Action**:
  1. Navigate to **Servers** (`/servers`).
  2. Show three active upstreams:
     - **WooCommerce MCP** (`store-woocommerce-store-woo-mcp.store-default.svc.cluster.local:3100/mcp`)
     - **Notes MCP** (`notes-mcp.conduit-system.svc.cluster.local:3200/mcp` with atomic persistent volume)
     - **Utils MCP** (`utils-mcp.conduit-system.svc.cluster.local:3300/mcp` with AST math sandbox)
  3. Click **View Tools** on WooCommerce.
  4. Demonstrate the **Approval State Machine**:
     - Explain how newly discovered tools start in `pending` quarantine.
     - Show tool inspection, input parameter schemas, and click **Approve All**.
  5. Demonstrate **Policies** (`/policies`):
     - Show the production default: non-admin members are restricted to read-only tools (`list_*`, `get_*`).

---

### [04:30 – 07:00] Team Management, Member Onboarding & One-Time API Keys
- **Narration**:
  *"Let's onboard a team member and grant them an MCP access key without ever exposing store credentials."*
- **Action**:
  1. Navigate to **Team** (`/team`).
  2. Click **Invite Member**, enter `analyst@company.com`, select role `member`, click **Generate Invite**.
  3. Copy invite link and open in an Incognito window:
     `http://dashboard.localhost/accept-invite?token=...`
  4. Register the user with a password.
  5. As the newly logged-in member, navigate to **Account > API Keys** (`/keys`).
  6. Click **Generate API Key**, label it `cursor-ide`.
  7. Show the **One-Time Key Reveal Modal**:
     - Copy the key (`mcpgw_...`).
     - Explain that the secret token is hashed using HMAC-SHA256 with a server-side pepper and cannot be retrieved again.

---

### [07:00 – 09:30] External Client Invocation & Multi-Upstream Execution
- **Narration**:
  *"Now we switch to our terminal to act as an external client—like Claude Code or Cursor—connecting directly to the HTTP MCP front door."*
- **Action**:
  1. Discover all aggregated tools:
     ```bash
     export API_KEY="mcpgw_..."
     curl -s -X POST http://gateway.localhost/mcp \
       -H "Authorization: Bearer $API_KEY" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
     ```
  2. Execute a calculation via `utils-mcp`:
     ```bash
     curl -s -X POST http://gateway.localhost/mcp \
       -H "Authorization: Bearer $API_KEY" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"utils__calculate","arguments":{"expression":"125 * 8 - 50"}}}' | jq .
     ```
  3. Create an operational note via `notes-mcp`:
     ```bash
     curl -s -X POST http://gateway.localhost/mcp \
       -H "Authorization: Bearer $API_KEY" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"notes__create_note","arguments":{"title":"Inventory Check","content":"Verified warehouse stock against Woo catalog.","tags":["inventory"]}}}' | jq .
     ```
  4. Query WooCommerce store orders:
     ```bash
     curl -s -X POST http://gateway.localhost/mcp \
       -H "Authorization: Bearer $API_KEY" \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"woo__list_orders","arguments":{"per_page":5}}}' | jq .
     ```

---

### [09:30 – 12:00] Interactive Chat Agent & Destructive Confirmation Gate
- **Narration**:
  *"Next, let's explore the Conduit interactive AI chat agent, which autonomously plans and coordinates tools across multiple servers."*
- **Action**:
  1. Back in the Admin dashboard, navigate to **Chat** (`/chat`).
  2. Enter multi-step prompt:
     `"Create a new product called 'Conduit Thermal Tumbler' for $28.50, and save an entry in notes summarizing what you created."`
  3. Observe live Server-Sent Events (SSE) streaming tokens.
  4. Point out the **Confirmation Gate**:
     - Mutating or destructive actions display an interactive `Approve / Deny` confirmation button before executing.
  5. Click **Approve**.
  6. The agent calls `woo__create_product`, then immediately calls `notes__create_note`.
  7. Open `http://shop.localhost` in a new tab: show the new tumbler product live in the storefront catalog!

---

### [12:00 – 14:00] Failure Isolation & Instant Key Revocation
- **Narration**:
  *"Enterprise resilience means partial failures do not bring down the platform."*
- **Action**:
  1. Kill the `utils-mcp` pod in Kubernetes:
     ```bash
     kubectl delete pod -n conduit-system -l app.kubernetes.io/name=utils-mcp
     ```
  2. In the dashboard, show `utils-mcp` transitioning gracefully to `unreachable`.
  3. Re-run WooCommerce tool queries: show that `woo-mcp` and `notes-mcp` continue operating without latency or error.
  4. Show instant key revocation:
     - In Admin Dashboard, revoke the member's API key.
     - Re-run curl in terminal: immediate HTTP `401 Unauthorized`.

---

### [14:00 – 15:00] Forensic Audit Trail & CSV Export
- **Narration**:
  *"Every single operation is forensically attributed to the exact user and API key."*
- **Action**:
  1. Navigate to **Audit** (`/audit`).
  2. Review the chronologically ordered audit logs showing User ID, server, tool name, execution latency, and success status.
  3. Click **Export CSV**.
  4. Highlight Conduit's spreadsheet formula injection defense: any argument starting with `=`, `+`, `-`, or `@` is automatically neutralized.
  5. Conclude walkthrough.
