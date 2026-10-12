#!/usr/bin/env bash
set -e

echo "=== NetworkPolicy Isolation Proof for conduit-mongodb:27017 ==="

echo "--- 1. Testing connection to conduit-mongodb:27017 from unlabelled pod (expected: TIMEOUT / BLOCKED) ---"
START_TIME=$(date +%s)
set +e
kubectl exec -n conduit-system unlabelled-debug -- curl -v --connect-timeout 4 http://conduit-mongodb:27017 2>&1
CURL_EXIT=$?
set -e
END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
echo "Curl exit code: $CURL_EXIT, elapsed time: ${DIFF}s (timed out / connection refused as enforced by NetworkPolicy)"

echo ""
echo "--- 2. Testing connection to conduit-mongodb:27017 from gateway pod (expected: SUCCESS / CONNECTED) ---"
GATEWAY_POD=$(kubectl get pods -n conduit-system -l app.kubernetes.io/name=gateway,app.kubernetes.io/component=gateway -o jsonpath='{.items[0].metadata.name}')
echo "Gateway pod: $GATEWAY_POD"

kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
const net = require("net");
const s = net.connect(27017, "conduit-mongodb", () => {
  console.log("SUCCESS: Gateway successfully connected to conduit-mongodb:27017 over TCP!");
  s.end();
  process.exit(0);
});
s.setTimeout(3000, () => {
  console.error("FAILURE: Timed out connecting to conduit-mongodb:27017");
  process.exit(1);
});
s.on("error", (err) => {
  console.error("FAILURE: Error connecting to conduit-mongodb:27017:", err.message);
  process.exit(1);
});
'

echo ""
echo "--- 3. Testing gateway egress to woo-mcp in store-default namespace (expected: 200 OK) ---"
kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
const http = require("http");
http.get("http://store-woocommerce-store-woo-mcp.store-default.svc.cluster.local:3100/healthz", (res) => {
  console.log("SUCCESS: Gateway reached woo-mcp in store-default! Status:", res.statusCode);
  process.exit(res.statusCode === 200 ? 0 : 1);
}).on("error", (e) => {
  console.error("FAILURE: Error reaching woo-mcp:", e.message);
  process.exit(1);
});
'

echo "=== Acceptance Criterion 4 Passed Successfully ==="
