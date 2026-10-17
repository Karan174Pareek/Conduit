# Conduit — Complete Live Demo Script & Walkthrough

This document provides a step-by-step walkthrough for evaluating and demonstrating the Conduit Team MCP Gateway and WooCommerce platform on Kubernetes.

---

## 1. Quick Access Links & Default Credentials

| Service | Local URL | Role / Authentication |
|---|---|---|
| **Conduit Dashboard** | [http://dashboard.localhost](http://dashboard.localhost) | Admin: `admin@conduit.localhost` / `Password123!Secure` (or cluster secret) |
| **Gateway MCP Front Door** | [http://gateway.localhost/mcp](http://gateway.localhost/mcp) | Bearer Token: `Authorization: Bearer mcpgw_<prefix>_<secret>` |
| **WooCommerce Storefront** | [http://shop.localhost](http://shop.localhost) | Public shop browsing & ordering |
| **WordPress Admin** | [http://shop.localhost/wp-admin](http://shop.localhost/wp-admin) | Store Admin: `admin` / Password from `store-secrets` |

---

## 2. Step-by-Step Demonstration Walkthrough

### Step 1: Cluster Health & Admin Login
1. Open your browser and navigate to **[http://dashboard.localhost](http://dashboard.localhost)**.
2. Sign in with the bootstrap admin credentials:
   - **Email**: `admin@conduit.localhost`
   - **Password**: Retrieved dynamically from Kubernetes:
     ```bash
     kubectl get secret conduit-secrets -n conduit-system -o jsonpath="{.data.BOOTSTRAP_ADMIN_PASSWORD}" | base64 -d
     ```
3. Observe the unified dashboard overview displaying upstream server statuses, active tool count, and recent audit activity.

### Step 2: Multi-Upstream Server Discovery & Governance
1. Click **Servers** in the navigation sidebar (`/servers`).
2. Observe the active upstream servers:
   - **WooCommerce Store MCP**: `http://store-woocommerce-store-woo-mcp.store-default.svc.cluster.local:3100/mcp`
   - **Demo Notes MCP**: `http://conduit-demo-notes-mcp.conduit-system.svc.cluster.local:3200/mcp`
   - **Demo Utils MCP**: `http://conduit-demo-utils-mcp.conduit-system.svc.cluster.local:3300/mcp`
3. Click **View Tools** on any server to inspect its tool catalog.
4. **Tool Approval Workflow**:
   - Upstream tools start in pending approval state before being published.
   - Click **Approve** on individual tools or **Approve All** to publish them to team members.
   - Click **Quarantine** to immediately remove a tool from the gateway catalog without taking the server down.

### Step 3: Team Collaboration & Member Key Issuance
1. Navigate to **Team** (`/team`).
2. Click **Invite Member**, enter an email (e.g. `analyst@company.com`), and select the `member` role.
3. Copy the generated invite link (`http://dashboard.localhost/accept-invite?token=...`).
4. In an incognito tab, open the invite link, enter the member's name and password, and complete registration.
5. In the member session, navigate to **API Keys** (`/keys`).
6. Click **Create API Key**, enter a label (e.g. `cursor-dev-key`), and click **Create**.
7. **One-Time Key Reveal**:
   - The full secret key (`mcpgw_...`) is presented in a modal with one-click copy.
   - It is never stored in plaintext and cannot be retrieved again after closing.

### Step 4: Multi-Upstream Tool Invocation
Invoke tools across WooCommerce, Notes, and Utils through the single Gateway front door (`http://gateway.localhost/mcp`):

```bash
# Export the issued API key
export API_KEY="mcpgw_..."

# 1. Discover all aggregated tools
curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq .

# 2. Execute safe math calculation on Demo Utils MCP
curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "utils__utils_calculate",
      "arguments": { "expression": "125 * 8 - 50" }
    }
  }' | jq .

# 3. Create a note on Demo Notes MCP
curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "notes__notes_create",
      "arguments": {
        "title": "Inventory Audit",
        "content": "All WooCommerce products verified against warehouse stock.",
        "tags": ["audit", "q4"]
      }
    }
  }' | jq .

# 4. Query live WooCommerce orders
curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "woo__list_orders",
      "arguments": { "per_page": 5 }
    }
  }' | jq .
```

### Step 5: Interactive Chat Agent with Live Tool Calling
1. In the Conduit Dashboard, click **Chat** (`/chat`).
2. Ask natural language questions that require autonomous tool invocation:
   - *"What tools do you have access to?"*
   - *"Calculate 25 * 40 + 150 using your calculator tool."*
   - *"Create a note titled 'Meeting Action Items' with content 'Follow up with vendor'."*
   - *"Show me recent orders from our WooCommerce shop."*
3. Observe:
   - Real-time Server-Sent Events (SSE) streaming response deltas.
   - Collapsible tool execution cards showing:
     - Tool name (e.g. `utils__utils_calculate`)
     - Input arguments formatted as clean JSON
     - Output result and execution duration in milliseconds
   - Automatic conversation persistence in the sidebar with multi-turn context retention.

### Step 6: Security Defense & Policy Enforcement
1. **Instant Key Revocation**:
   - In **API Keys** (`/keys`), click **Revoke** on any active key.
   - Retrying the curl command with that key immediately returns `401 Unauthorized` (no caching lag).
2. **Cross-User Data Isolation**:
   - Conversations and API keys created by Member A are strictly isolated from Member B.
   - Attempts to access another user's conversation ID return a strict `404 Not Found`.
3. **Prompt Injection Canary Defense**:
   - If a rogue upstream server attempts prompt injection via tool descriptions, Conduit's schema sanitizer and tool execution guards quarantine untrusted payloads before passing them to the LLM.

### Step 7: Audit Logging & CSV Export
1. Navigate to **Audit** (`/audit`).
2. Observe full forensic tracking for every tool call executed across the platform:
   - Timestamp and actor email / user ID
   - Server slug and exposed tool name
   - Latency (execution duration in ms)
   - Status outcome (`success` / `error`)
3. Click **Export CSV** to download the audit log.
   - Formula cells starting with `=`, `+`, `-`, or `@` are automatically sanitized with leading apostrophes to protect analysts from spreadsheet formula injection (CSV Injection / CWE-1236).

---

## 3. Automated End-to-End Verification Suites

Run all automated verification suites with single Makefile targets:

```bash
# 1. Full Definition-of-Done (DoD) verification (11 criteria)
make e2e-dod

# 2. Comprehensive Gateway MCP protocol & resilience test (16 steps)
make e2e-gateway

# 3. Headless browser smoke test with Playwright
make e2e-ui
```

---

## 4. Resetting Demo State

To wipe demo records (notes, temporary orders, test keys) and return the cluster to a clean initial state:

```bash
bash scripts/demo-reset.sh
```
