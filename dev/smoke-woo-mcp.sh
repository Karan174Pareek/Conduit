#!/usr/bin/env bash
set -euo pipefail

# Smoke test script for woo-mcp service
echo "=== Starting woo-mcp Smoke Test ==="

# 1. Read secrets from environment or store-secrets secret in k8s
TOKEN="${MCP_BEARER_TOKEN:-$(kubectl get secret store-secrets -n store-default -o jsonpath='{.data.WOO_MCP_BEARER_TOKEN}' | base64 -d)}"
PORT="${WOO_MCP_PORT:-3100}"
HOST="${WOO_MCP_HOST:-127.0.0.1}"
BASE_URL="http://${HOST}:${PORT}"

echo "Targeting woo-mcp at ${BASE_URL}..."

# 2. Test /healthz (liveness) - must return 200 without auth
echo -n "Checking /healthz (liveness)... "
HEALTHZ_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/healthz")
if [ "$HEALTHZ_CODE" -eq 200 ]; then
  echo "OK (200)"
else
  echo "FAILED ($HEALTHZ_CODE)"
  exit 1
fi

# 3. Test /readyz (readiness) - must return 200 without auth
echo -n "Checking /readyz (readiness)... "
READYZ_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/readyz")
if [ "$READYZ_CODE" -eq 200 ]; then
  echo "OK (200)"
else
  echo "FAILED ($READYZ_CODE)"
  exit 1
fi

# 4. Test /mcp without token - must return 401
echo -n "Checking /mcp without token returns 401... "
UNAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
if [ "$UNAUTH_CODE" -eq 401 ]; then
  echo "OK (401)"
else
  echo "FAILED ($UNAUTH_CODE)"
  exit 1
fi

# 5. Test tools/list with token
echo -n "Checking tools/list with bearer token... "
TOOLS_RESP=$(curl -s -X POST "${BASE_URL}/mcp" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')

if echo "$TOOLS_RESP" | grep -q "list_products" && echo "$TOOLS_RESP" | grep -q "sales_summary"; then
  echo "OK (all tools listed)"
else
  echo "FAILED"
  echo "$TOOLS_RESP"
  exit 1
fi

echo "=== All smoke tests passed! ==="
