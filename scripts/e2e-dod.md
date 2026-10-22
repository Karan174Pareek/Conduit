# Conduit Definition of Done (DoD) End-to-End Verification Checklist

This manual checklist and verification protocol accompanies `scripts/e2e-dod.sh`. It provides step-by-step verification instructions, exact terminal commands, API payloads, and expected evidence for all acceptance criteria defined in **docs/PRD.md §7** and the Urumi AI FDE Round 1 demonstration requirements.

---

## Prerequisites & Pre-Flight Checks

Before beginning the demonstration or running tests, verify the following baseline conditions:

1. **Local Host Resolution** (`/etc/hosts` or `C:\Windows\System32\drivers\etc\hosts`):
   ```text
   127.0.0.1 dashboard.localhost gateway.localhost shop.localhost
   ::1       dashboard.localhost gateway.localhost shop.localhost
   ```
2. **Kubernetes Cluster (`k3d-conduit`) Status**:
   ```bash
   kubectl get nodes
   # Expected: k3d-conduit-server-0 Ready
   ```
3. **Pods Running and Ready**:
   ```bash
   kubectl get pods -n conduit-system
   kubectl get pods -n store-default
   # Expected: All application pods Running (1/1)
   ```
4. **Ingress Accessibility**:
   - `http://dashboard.localhost/` -> HTTP 200 (Dashboard UI)
   - `http://shop.localhost/` -> HTTP 200 (WooCommerce Storefront)
   - `http://gateway.localhost/healthz` -> HTTP 200 (`{"status":"ok"}`)

---

## Step 1: Storefront Add-to-Cart & COD Checkout

### Objective
Verify that an end-user shopper can browse products, add an item to the shopping cart, complete checkout with Cash on Delivery (COD), and have the order reliably persisted and visible in WooCommerce Admin.

### Automated Command
Included in `scripts/e2e-dod.sh` (Step 2).

### Manual Step-by-Step Walkthrough
1. **Open Storefront in Browser**:
   - Navigate to `http://shop.localhost/` or `http://shop.localhost/shop/`.
   - Verify product catalog displays items (e.g., *Conduit Edge Node*, *Persistence Test Gadget*).
2. **Add to Cart**:
   - Click **Add to cart** on any available product (or navigate to `http://shop.localhost/?add-to-cart=10`).
   - Navigate to `http://shop.localhost/cart/` to verify item quantity and line item subtotal.
3. **Proceed to Checkout**:
   - Navigate to `http://shop.localhost/checkout/`.
   - Fill billing details:
     - First Name: `DoD`
     - Last Name: `Customer`
     - Address: `101 Conduit Boulevard`
     - City: `San Francisco`, State: `CA`, Postcode: `94105`
     - Email: `customer@conduit.localhost`
   - Select payment method: **Cash on delivery (COD)**.
   - Click **Place order**.
4. **Verify Order Confirmation**:
   - Browser redirects to `/checkout/order-received/<ORDER_ID>/?key=wc_order_...`.
   - Verify confirmation banner: *"Thank you. Your order has been received."*
5. **Verify Order in WooCommerce Admin**:
   ```bash
   kubectl exec -n store-default deployment/store-woocommerce-store-wordpress -c wordpress -- \
     wp wc shop_order get <ORDER_ID> --user=admin --format=json --allow-root
   ```
   **Expected Output**:
   - `"status": "processing"`
   - `"payment_method": "cod"`
   - `"payment_method_title": "Cash on delivery"`
   - Correct customer name and line items matching the purchase.

---

## Step 2: User A (Chat Agent) Product Creation & Orders Query

### Objective
Demonstrate the interactive chat agent creating a real WooCommerce product, confirming its appearance on the live storefront, placing an order by hand, and querying today's orders through the chat interface.

### Automated Command
Included in `scripts/e2e-dod.sh` (Step 3).

### Manual Step-by-Step Walkthrough
1. **Retrieve Bootstrap Admin Credentials**:
   ```bash
   ADMIN_PWD=$(kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.BOOTSTRAP_ADMIN_PASSWORD}' | base64 -d)
   ADMIN_EMAIL=$(kubectl get configmap conduit-config -n conduit-system -o jsonpath='{.data.BOOTSTRAP_ADMIN_EMAIL}')
   ```
2. **Log In to Dashboard**:
   - Open `http://dashboard.localhost/` in the browser.
   - Log in with `$ADMIN_EMAIL` and `$ADMIN_PWD`.
3. **Navigate to Chat Interface**:
   - Click **Chat** in the left navigation sidebar.
4. **Prompt the Agent to Create a Product**:
   - Prompt:
     ```text
     Create a new product named "Conduit Field Gateway" with regular_price "149.00" and status "publish"
     ```
   - Agent invokes `woo__create_product` with:
     ```json
     {
       "name": "Conduit Field Gateway",
       "regular_price": "149.00",
       "status": "publish"
     }
     ```
   - Verify agent replies with confirmation, product ID, and permalink.
5. **Verify Product on Storefront**:
   - In a separate browser tab, navigate to `http://shop.localhost/shop/`.
   - Confirm *"Conduit Field Gateway"* appears in the product grid with price `$149.00`.
6. **Place an Order by Hand**:
   - Add *"Conduit Field Gateway"* to cart and complete checkout with COD (or use WP-CLI):
     ```bash
     kubectl exec -n store-default deployment/store-woocommerce-store-wordpress -c wordpress -- \
       wp wc shop_order create --user=admin --status=processing \
       --billing='{"first_name":"Hand","last_name":"Placed","email":"shopper@conduit.localhost"}' \
       --line_items="[{\"product_id\":<PROD_ID>,\"quantity\":1}]" --allow-root
     ```
7. **Ask Agent Today's Orders**:
   - In the chat interface, enter:
     ```text
     What orders came in today?
     ```
   - Agent invokes `woo__list_orders` and streams the order list including the newly created order.

---

## Step 3: User B (External MCP Client) Multi-Upstream Execution

### Objective
Demonstrate an external MCP client (or MCP Inspector / Claude Code) connecting exclusively using the gateway URL and User B's API key. The client discovers tools from all registered upstream servers, executes an orders query, and completes a multi-upstream coordinated workflow.

### Automated Command
Included in `scripts/e2e-dod.sh` (Step 4).

### Manual Step-by-Step Walkthrough
1. **Invite User B (Member Role)**:
   - In Dashboard under **Team**, click **Invite Member**.
   - Email: `member-b@conduit.localhost`, Role: `member`.
   - Complete invitation acceptance at `http://dashboard.localhost/accept-invite?token=...`.
2. **Generate API Key for User B**:
   - Log in as User B at `http://dashboard.localhost/`.
   - Navigate to **API Keys** -> **Generate New Key**.
   - Copy key: `mcpgw_<prefix>_<secret>` (only shown once).
3. **Discover Tools via External MCP Client**:
   ```bash
   curl -s -X POST http://gateway.localhost/mcp \
     -H "Authorization: Bearer <USER_B_API_KEY>" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
   **Expected Evidence**:
   - At least 16 tools discovered with `slug__tool` namespacing:
     - `woo__create_product`, `woo__list_orders`, `woo__sales_summary`...
     - `notes__notes_create`, `notes__notes_list`, `notes__notes_search`...
     - `utils__utils_calculate`, `utils__utils_format_date`...
4. **Query Orders via External Client**:
   ```bash
   curl -s -X POST http://gateway.localhost/mcp \
     -H "Authorization: Bearer <USER_B_API_KEY>" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"woo__list_orders","arguments":{"per_page":5}}}'
   ```
   **Expected Evidence**:
   - Returns JSON-RPC result containing live orders array from WooCommerce.
5. **Run Multi-Upstream Prompt**:
   - **Step A: Save Order Memo to Notes MCP**:
     ```bash
     curl -s -X POST http://gateway.localhost/mcp \
       -H "Authorization: Bearer <USER_B_API_KEY>" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json, text/event-stream" \
       -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"notes__notes_create","arguments":{"title":"DoD Review Note","content":"Order processing coordinated with notes upstream","tags":["e2e","dod"]}}}'
     ```
   - **Step B: Perform Revenue Calculation on Utils MCP**:
     ```bash
     curl -s -X POST http://gateway.localhost/mcp \
       -H "Authorization: Bearer <USER_B_API_KEY>" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json, text/event-stream" \
       -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"utils__utils_calculate","arguments":{"expression":"149 * 2 + 50"}}}'
     ```
   **Expected Evidence**:
   - Notes server returns new note ID (`note-...`).
   - Utils server returns `"result": 348`.

---

## Step 4: Access Revocation Enforcement

### Objective
Verify that revoking User B's API key immediately invalidates their access on subsequent tool discovery and tool execution calls.

### Automated Command
Included in `scripts/e2e-dod.sh` (Step 5).

### Manual Step-by-Step Walkthrough
1. **Delete / Revoke Key**:
   - As User B or Admin in Dashboard, navigate to **API Keys**.
   - Click **Revoke** / **Delete** on User B's key (or call `DELETE /api/keys/<KEY_ID>`).
2. **Attempt Subsequent MCP Call**:
   ```bash
   curl -i -X POST http://gateway.localhost/mcp \
     -H "Authorization: Bearer <USER_B_API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}'
   ```
   **Expected Evidence**:
   - HTTP status code: `401 Unauthorized`
   - Header: `WWW-Authenticate: Bearer`
   - Zero disclosure of key hash or revocation reason.

---

## Step 5: Upstream Disabling & Runtime Failure Isolation

### Objective
Demonstrate runtime fault tolerance and upstream lifecycle controls:
1. Disabling an upstream cleanly hides its tools from both external clients and chat agents.
2. Killing a pod on an upstream server does not degrade traffic to surviving upstreams (fault isolation).

### Automated Command
Included in `scripts/e2e-dod.sh` (Step 6).

### Manual Step-by-Step Walkthrough
1. **Disable Upstream**:
   - In Dashboard under **Servers**, find `Team Notes (Demo)` (`notes`).
   - Toggle switch to **Disabled** (or send `PATCH /api/servers/<ID>` with `{"enabled": false}`).
2. **Verify Tool Vanishing**:
   - Execute `tools/list` on `http://gateway.localhost/mcp`.
   - Confirm `notes__*` tools are completely absent from the returned catalog.
3. **Re-Enable Upstream**:
   - Toggle switch back to **Enabled**.
   - Confirm `notes__*` tools reappear.
4. **Kill Disposable Pod (`utils-mcp`)**:
   ```bash
   kubectl delete pod -n conduit-system -l app.kubernetes.io/name=utils-mcp --now --wait=false
   ```
5. **Verify Surviving Upstream Health**:
   - Immediately invoke `woo__list_orders` or `woo__sales_summary` on `http://gateway.localhost/mcp`.
   - Confirm response returns `200 OK` with valid content without timeout or hang.
6. **Verify Automatic Pod Recovery**:
   ```bash
   kubectl rollout status deployment/conduit-utils-mcp -n conduit-system --timeout=60s
   ```
   - Confirm Kubernetes restores the pod to Running (1/1).

---

## Step 6: Audit Logging Attribution & Multi-Tenant Data Isolation

### Objective
Prove that every tool call is persisted in the immutable audit log with full attribution (`userId`, `userEmail`, `tool`, `outcome`, `durationMs`), and prove that non-admin members cannot access admin logs or peer conversations.

### Automated Command
Included in `scripts/e2e-dod.sh` (Step 7).

### Manual Step-by-Step Walkthrough
1. **Admin Inspects Full Audit Log**:
   - Navigate to `http://dashboard.localhost/audit` in Dashboard.
   - Verify every tool call executed above has an entry:
     - Actor: User B (`dod-userb-...@conduit.localhost`) or User A
     - Tool: `woo__list_orders`, `notes__notes_create`, `utils__utils_calculate`
     - Outcome: `success`
     - Duration: Real measured latency in milliseconds
     - Args Summary: Parameter summary without plaintext secret leakage
2. **Export Audit Log as CSV**:
   - Click **Export CSV** (or `GET /api/audit/export.csv`).
   - Verify CSV cells with leading formula characters (`=`, `+`, `-`, `@`) are escaped with single quote (`'`) to prevent DDE formula injection.
3. **Verify Member Audit Isolation**:
   - Log in as User B (Member).
   - Navigate to `http://dashboard.localhost/audit`.
   - Verify User B sees *only* their own tool calls. Zero records from Administrator (`admin@conduit.localhost`) appear.
4. **Verify Cross-User Conversation Protection**:
   - Obtain an Admin conversation ID (`<ADMIN_CONV_ID>`).
   - Using User B's session cookie, attempt:
     ```bash
     curl -i -b "$USERB_COOKIE" http://dashboard.localhost/api/conversations/<ADMIN_CONV_ID>
     ```
   - Expected response: `HTTP 404 Not Found` (strict isolation enforced at query layer).

---

## Final Verification Checklist

| Criterion | Automated Script | Manual Verification Check | Status |
|---|---|---|---|
| All pods Running/Ready & Ingress URLs work | `scripts/e2e-dod.sh` (Step 1) | `kubectl get pods -A`, curl ingress URLs | PASS |
| Storefront add-to-cart + COD checkout | `scripts/e2e-dod.sh` (Step 2) | Browser checkout, `wp wc shop_order get` | PASS |
| User A (Chat Agent) creates product & answers orders | `scripts/e2e-dod.sh` (Step 3) | Dashboard Chat UI, Storefront verification | PASS |
| User B external MCP client tools/list across upstreams | `scripts/e2e-dod.sh` (Step 4) | `POST /mcp tools/list`, 16 tools found | PASS |
| Multi-upstream execution (two servers in one flow) | `scripts/e2e-dod.sh` (Step 4) | `notes__notes_create` + `utils__utils_calculate` | PASS |
| API Key revocation enforcement | `scripts/e2e-dod.sh` (Step 5) | `DELETE /api/keys/<id>`, verify HTTP 401 | PASS |
| Upstream disabling hides tools | `scripts/e2e-dod.sh` (Step 6) | `PATCH /api/servers/<id>`, tools vanish | PASS |
| Upstream pod kill isolation & recovery | `scripts/e2e-dod.sh` (Step 6) | `kubectl delete pod utils-mcp`, woo stays UP | PASS |
| Complete audit log attribution & tenant isolation | `scripts/e2e-dod.sh` (Step 7) | `/api/audit`, zero leakage, 404 cross-conv | PASS |

---

## Execution Instructions

To execute the entire automated suite end to end on the local cluster:
```bash
bash scripts/e2e-dod.sh
```
All created test products, orders, temporary keys, and users are automatically cleaned up at the end of the test run.
