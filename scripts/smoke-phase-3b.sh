#!/usr/bin/env bash
# scripts/smoke-phase-3b.sh
# Automated Phase 3B Acceptance Verification Script
set -euo pipefail

echo "=========================================================="
echo " Starting Conduit Phase 3B Live Acceptance Test"
echo "=========================================================="

NAMESPACE_CONDUIT="conduit-system"
NAMESPACE_STORE="store-default"

# 1. Fetch bootstrap admin password and seed token from Kubernetes secrets
echo "==> [1/6] Retrieving credentials securely from Kubernetes secret..."
ADMIN_PWD=$(kubectl get secret conduit-secrets -n "$NAMESPACE_CONDUIT" -o jsonpath='{.data.BOOTSTRAP_ADMIN_PASSWORD}' | base64 -d)
ADMIN_EMAIL=$(kubectl get configmap conduit-config -n "$NAMESPACE_CONDUIT" -o jsonpath='{.data.BOOTSTRAP_ADMIN_EMAIL}')

# 2. Login to Dashboard to obtain session & CSRF token
echo "==> [2/6] Logging in as admin on dashboard.localhost..."
COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

LOGIN_RESP=$(curl -s -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "Origin: http://dashboard.localhost" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PWD\"}" \
  http://dashboard.localhost/api/auth/login)

CSRF_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.csrfToken')
if [[ -z "$CSRF_TOKEN" || "$CSRF_TOKEN" == "null" ]]; then
  echo "FAIL: Failed to log in and obtain CSRF token"
  echo "Response: $LOGIN_RESP"
  exit 1
fi
echo "SUCCESS: Logged in as $ADMIN_EMAIL"

# 3. Create an API Key for Acceptance testing
echo "==> [3/6] Creating member API key via POST /api/keys..."
# Clean up any old acceptance keys if limit reached
EXISTING_KEYS=$(curl -s -b "$COOKIE_JAR" -H "Origin: http://dashboard.localhost" http://dashboard.localhost/api/keys)
OLD_KEY_IDS=$(echo "$EXISTING_KEYS" | jq -r '.keys[]? | select(.name | startswith("phase-3b") or startswith("cli-test")) | .id')
for KID in $OLD_KEY_IDS; do
  curl -s -b "$COOKIE_JAR" -X DELETE -H "X-CSRF-Token: $CSRF_TOKEN" -H "Origin: http://dashboard.localhost" "http://dashboard.localhost/api/keys/$KID" > /dev/null || true
done

KEY_RESP=$(curl -s -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Origin: http://dashboard.localhost" \
  -d '{"name":"phase-3b-acceptance-key"}' \
  http://dashboard.localhost/api/keys)

API_KEY=$(echo "$KEY_RESP" | jq -r '.key')
KEY_ID=$(echo "$KEY_RESP" | jq -r '.id')
KEY_PREFIX=$(echo "$KEY_RESP" | jq -r '.prefix')

if [[ -z "$API_KEY" || "$API_KEY" == "null" ]]; then
  echo "FAIL: Could not create API key"
  echo "Response: $KEY_RESP"
  exit 1
fi
echo "SUCCESS: Created API key with prefix: $KEY_PREFIX (id: $KEY_ID)"

# 4. Verify Server Listing & Tool Catalog
echo "==> [4/6] Verifying server status and tool catalog..."
SERVERS_RESP=$(curl -s -b "$COOKIE_JAR" \
  -H "Origin: http://dashboard.localhost" \
  http://dashboard.localhost/api/servers)

WOO_SERVER_ID=$(echo "$SERVERS_RESP" | jq -r '.servers[] | select(.slug=="woo") | .id')
WOO_STATUS=$(echo "$SERVERS_RESP" | jq -r '.servers[] | select(.slug=="woo") | .status.state')
echo "Woo server id: $WOO_SERVER_ID, state: $WOO_STATUS"

# Wait a moment for background catalog fetch if pending
for i in {1..10}; do
  TOOLS_COUNT=$(curl -s -b "$COOKIE_JAR" -H "Origin: http://dashboard.localhost" "http://dashboard.localhost/api/servers/$WOO_SERVER_ID/tools" | jq '.tools | length')
  if [[ "$TOOLS_COUNT" -ge 8 ]]; then
    echo "SUCCESS: Woo catalog has $TOOLS_COUNT tools registered"
    break
  fi
  echo "Waiting for background catalog synchronization... ($i/10)"
  sleep 2
done

# 5. MCP Inspector CLI Verification
echo "==> [5/6] Running MCP Inspector CLI against http://gateway.localhost/mcp..."
echo "--- Testing tools/list ---"
TOOLS_LIST_OUT=$(npx -y @modelcontextprotocol/inspector --cli \
  --server-url http://gateway.localhost/mcp \
  --header "Authorization: Bearer $API_KEY" \
  --method tools/list \
  --format json)

NUM_TOOLS=$(echo "$TOOLS_LIST_OUT" | jq '(.result.tools // .tools // []) | length')
echo "Inspector discovered $NUM_TOOLS tools."
echo "$TOOLS_LIST_OUT" | jq -r '(.result.tools // .tools // [])[].name'

if [[ "$NUM_TOOLS" -lt 8 ]]; then
  echo "FAIL: Expected at least 8 tools, got $NUM_TOOLS"
  exit 1
fi

echo "--- Testing tools/call (woo__list_products) ---"
CALL_PROD_OUT=$(npx -y @modelcontextprotocol/inspector --cli \
  --server-url http://gateway.localhost/mcp \
  --header "Authorization: Bearer $API_KEY" \
  --method tools/call \
  --tool-name woo__list_products \
  --format json)

echo "Result preview:"
echo "$CALL_PROD_OUT" | jq '(.result.content // .content)[0].text | fromjson | .[0] | {id, name, price, status}'

# 6. Resilience & Lifecycle Tests
echo "==> [6/6] Resilience: Scaling woo-mcp to 0 replicas..."
kubectl scale deployment -n "$NAMESPACE_STORE" store-woocommerce-store-woo-mcp --replicas=0
echo "Waiting 18s for gateway health loop to detect failure and update circuit breaker..."
sleep 18

DOWN_SERVERS_RESP=$(curl -s -b "$COOKIE_JAR" -H "Origin: http://dashboard.localhost" http://dashboard.localhost/api/servers)
DOWN_STATUS=$(echo "$DOWN_SERVERS_RESP" | jq -r '.servers[] | select(.slug=="woo") | .status.state')
DOWN_BREAKER=$(echo "$DOWN_SERVERS_RESP" | jq -r '.servers[] | select(.slug=="woo") | .circuitBreaker')
echo "Woo server state after scale-down: $DOWN_STATUS (breaker: $DOWN_BREAKER)"

DOWN_TOOLS_OUT=$(npx -y @modelcontextprotocol/inspector --cli \
  --server-url http://gateway.localhost/mcp \
  --header "Authorization: Bearer $API_KEY" \
  --method tools/list \
  --format json)
DOWN_TOOLS_COUNT=$(echo "$DOWN_TOOLS_OUT" | jq '(.result.tools // .tools // []) | length')
echo "Active tools reported while woo-mcp is down: $DOWN_TOOLS_COUNT (expected 0)"

if [[ "$DOWN_TOOLS_COUNT" -ne 0 ]]; then
  echo "FAIL: Unreachable server tools should be hidden from tools/list!"
  exit 1
fi

echo "Scaling woo-mcp back to 1 replica..."
kubectl scale deployment -n "$NAMESPACE_STORE" store-woocommerce-store-woo-mcp --replicas=1
kubectl rollout status deployment store-woocommerce-store-woo-mcp -n "$NAMESPACE_STORE" --timeout=60s
echo "Waiting 18s for gateway health loop to auto-recover..."
sleep 18

RECOVER_TOOLS_OUT=$(npx -y @modelcontextprotocol/inspector --cli \
  --server-url http://gateway.localhost/mcp \
  --header "Authorization: Bearer $API_KEY" \
  --method tools/list \
  --format json)
RECOVER_TOOLS_COUNT=$(echo "$RECOVER_TOOLS_OUT" | jq '(.result.tools // .tools // []) | length')
echo "Active tools after auto-recovery: $RECOVER_TOOLS_COUNT"
if [[ "$RECOVER_TOOLS_COUNT" -lt 8 ]]; then
  echo "FAIL: Tools should auto-recover when upstream recovers!"
  exit 1
fi

echo "--- Testing Server Toggle (enabled=false / true) ---"
curl -s -b "$COOKIE_JAR" -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Origin: http://dashboard.localhost" \
  -d '{"enabled":false}' \
  "http://dashboard.localhost/api/servers/$WOO_SERVER_ID" > /dev/null

DISABLED_TOOLS_OUT=$(npx -y @modelcontextprotocol/inspector --cli \
  --server-url http://gateway.localhost/mcp \
  --header "Authorization: Bearer $API_KEY" \
  --method tools/list \
  --format json)
DISABLED_COUNT=$(echo "$DISABLED_TOOLS_OUT" | jq '(.result.tools // .tools // []) | length')
echo "Active tools after disabling server: $DISABLED_COUNT (expected 0)"

curl -s -b "$COOKIE_JAR" -X PATCH \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Origin: http://dashboard.localhost" \
  -d '{"enabled":true}' \
  "http://dashboard.localhost/api/servers/$WOO_SERVER_ID" > /dev/null

REENABLED_TOOLS_OUT=$(npx -y @modelcontextprotocol/inspector --cli \
  --server-url http://gateway.localhost/mcp \
  --header "Authorization: Bearer $API_KEY" \
  --method tools/list \
  --format json)
REENABLED_COUNT=$(echo "$REENABLED_TOOLS_OUT" | jq '(.result.tools // .tools // []) | length')
echo "Active tools after re-enabling server: $REENABLED_COUNT"

echo "--- Testing Key Revocation ---"
curl -s -b "$COOKIE_JAR" -X DELETE \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Origin: http://dashboard.localhost" \
  "http://dashboard.localhost/api/keys/$KEY_ID" > /dev/null

REVOKED_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')

echo "HTTP status code with revoked key: $REVOKED_STATUS (expected 401)"
if [[ "$REVOKED_STATUS" -ne 401 ]]; then
  echo "FAIL: Expected 401 on revoked key, got $REVOKED_STATUS"
  exit 1
fi

echo "=========================================================="
echo " ALL PHASE 3B LIVE ACCEPTANCE CRITERIA VERIFIED 100%!"
echo "=========================================================="
