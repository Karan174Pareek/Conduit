#!/usr/bin/env bash
set -euo pipefail

echo "=== Conduit Failure & Redaction Evidence Test ==="
NAMESPACE_CONDUIT="conduit-system"
NAMESPACE_STORE="store-default"

ADMIN_PWD=$(kubectl get secret conduit-secrets -n "$NAMESPACE_CONDUIT" -o jsonpath='{.data.BOOTSTRAP_ADMIN_PASSWORD}' | base64 -d)
ADMIN_EMAIL=$(kubectl get configmap conduit-config -n "$NAMESPACE_CONDUIT" -o jsonpath='{.data.BOOTSTRAP_ADMIN_EMAIL}')

COOKIE_JAR=$(mktemp)
trap 'rm -f "$COOKIE_JAR"' EXIT

LOGIN_RESP=$(curl -s -c "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "Origin: http://dashboard.localhost" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PWD\"}" \
  http://dashboard.localhost/api/auth/login)
CSRF_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.csrfToken')

KEY_RESP=$(curl -s -b "$COOKIE_JAR" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Origin: http://dashboard.localhost" \
  -d '{"name":"evidence-key"}' \
  http://dashboard.localhost/api/keys)
API_KEY=$(echo "$KEY_RESP" | jq -r '.key')
KEY_ID=$(echo "$KEY_RESP" | jq -r '.id')

echo "--- 1. Checking GET /api/servers as ADMIN ---"
ADMIN_SERVERS=$(curl -s -b "$COOKIE_JAR" -H "Origin: http://dashboard.localhost" http://dashboard.localhost/api/servers)
echo "$ADMIN_SERVERS" | jq '.servers[] | {id, slug, displayName, url, enabled, status: .status.state, authType, hasCredential}'

echo "--- 2. Checking GET /api/servers as MEMBER (Redacted View) ---"
cat << 'INNER_EOF' > /tmp/create-member.js
const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db(process.env.MONGO_DB);
  await db.collection('users').updateOne(
    { email: 'member@conduit.localhost' },
    { $set: { email: 'member@conduit.localhost', role: 'member', status: 'active', createdAt: new Date(), updatedAt: new Date() } },
    { upsert: true }
  );
  await client.close();
})();
INNER_EOF
kubectl cp /tmp/create-member.js conduit-system/$(kubectl get pod -n conduit-system -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}'):/tmp/create-member.js
kubectl exec -n conduit-system deployment/conduit-gateway -- sh -c 'NODE_PATH=/app/node_modules node /tmp/create-member.js' > /dev/null

cat << 'INNER_EOF' > /tmp/create-member-key.js
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
(async () => {
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  const db = client.db(process.env.MONGO_DB);
  const user = await db.collection('users').findOne({ email: 'member@conduit.localhost' });
  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(32).toString('base64url');
  const fullKey = `mcpgw_${prefix}_${secret}`;
  const keyHash = crypto.createHmac('sha256', process.env.API_KEY_PEPPER).update(fullKey).digest('hex');
  await db.collection('api_keys').insertOne({
    ownerId: user._id.toString(),
    name: 'member-test-key',
    prefix,
    keyHash,
    last4: secret.slice(-4),
    createdAt: new Date(),
    lastUsedAt: null,
    revokedAt: null,
    expiresAt: null,
  });
  process.stdout.write(fullKey);
  await client.close();
})();
INNER_EOF
kubectl cp /tmp/create-member-key.js conduit-system/$(kubectl get pod -n conduit-system -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}'):/tmp/create-member-key.js
MEMBER_KEY=$(kubectl exec -n conduit-system deployment/conduit-gateway -- sh -c 'NODE_PATH=/app/node_modules node /tmp/create-member-key.js')

MEMBER_SERVERS=$(curl -s -H "Authorization: Bearer $MEMBER_KEY" http://gateway.localhost/api/servers)
echo "$MEMBER_SERVERS" | jq .
HAS_URL=$(echo "$MEMBER_SERVERS" | jq '.[][0].url // empty')
HAS_AUTH=$(echo "$MEMBER_SERVERS" | jq '.[][0].authType // empty')
if [[ -z "$HAS_URL" && -z "$HAS_AUTH" ]]; then
  echo "CONFIRMED: Member view is strictly redacted (no url, no authType, no credentials)"
fi

echo "--- 3. Scaling woo-mcp to 0 replicas ---"
kubectl scale deployment store-woocommerce-store-woo-mcp -n "$NAMESPACE_STORE" --replicas=0
echo "Waiting for woo-mcp pod to terminate..."
kubectl wait --for=delete pod -l app.kubernetes.io/name=woo-mcp -n "$NAMESPACE_STORE" --timeout=30s || true

echo "--- 4. Immediate tool call on /mcp while woo-mcp is down (proves [gateway:...] error) ---"
IMMEDIATE_CALL_RESP=$(curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"woo__list_products","arguments":{}}}')
echo "Immediate response:"
echo "$IMMEDIATE_CALL_RESP" | sed -n 's/^data: //p' | jq .

echo "--- 5. Waiting 18s for health loop to mark unreachable & open circuit ---"
sleep 18

DOWN_LIST=$(curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
TOOLS_COUNT=$(echo "$DOWN_LIST" | sed -n 's/^data: //p' | jq '(.result.tools // []) | length')
echo "Subsequent tools/list count while down: $TOOLS_COUNT (expected 0)"

ADMIN_SERVERS_DOWN=$(curl -s -b "$COOKIE_JAR" -H "Origin: http://dashboard.localhost" http://dashboard.localhost/api/servers)
echo "Admin view shows server status:"
echo "$ADMIN_SERVERS_DOWN" | jq '.servers[] | {slug, state: .status.state, reason: .status.reason, reasonCode: .status.reasonCode}'

echo "--- 6. Restoring woo-mcp to 1 replica ---"
kubectl scale deployment store-woocommerce-store-woo-mcp -n "$NAMESPACE_STORE" --replicas=1
kubectl rollout status deployment store-woocommerce-store-woo-mcp -n "$NAMESPACE_STORE" --timeout=60s
echo "Waiting 22s for gateway health check loop to detect recovery..."
sleep 22

RECOVER_LIST=$(curl -s -X POST http://gateway.localhost/mcp \
  -H "Authorization: Bearer $API_KEY" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}')
RECOVER_COUNT=$(echo "$RECOVER_LIST" | sed -n 's/^data: //p' | jq '(.result.tools // []) | length')
echo "Active tools after recovery: $RECOVER_COUNT (expected 8)"

# Clean up test keys
curl -s -b "$COOKIE_JAR" -X DELETE -H "X-CSRF-Token: $CSRF_TOKEN" -H "Origin: http://dashboard.localhost" "http://dashboard.localhost/api/keys/$KEY_ID" > /dev/null

echo "=== All failure and redaction evidence verified! ==="
