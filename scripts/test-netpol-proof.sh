#!/usr/bin/env bash
set -e

echo "=== NetworkPolicy Isolation Proof for MongoDB & woo-mcp ==="

# Ensure long-running unlabelled pod in default namespace
if ! kubectl get pod -n default unlabelled-default >/dev/null 2>&1; then
  echo "Starting unlabelled pod in namespace default..."
  kubectl run unlabelled-default -n default --image=rancher/mirrored-library-busybox:1.37.0 --restart=Always -- sleep infinity
  kubectl wait --for=condition=ready pod/unlabelled-default -n default --timeout=30s
fi

GATEWAY_POD=$(kubectl get pods -n conduit-system -l app.kubernetes.io/name=gateway,app.kubernetes.io/component=gateway -o jsonpath='{.items[0].metadata.name}')
echo "Gateway pod: $GATEWAY_POD"

MONGO_IP=$(kubectl get svc -n conduit-system conduit-mongodb -o jsonpath='{.spec.clusterIP}')
echo "conduit-mongodb ClusterIP: $MONGO_IP"

WOO_MCP_IP=$(kubectl get svc -n store-default store-woocommerce-store-woo-mcp -o jsonpath='{.spec.clusterIP}')
echo "woo-mcp ClusterIP: $WOO_MCP_IP"

echo ""
echo "--- 1. Testing conduit-mongodb:27017 from unlabelled pod in default namespace (expected: BLOCKED / TIMEOUT) ---"
set +e
START_TIME=$(date +%s)
kubectl exec -n default unlabelled-default -- nc -zv -w 3 "$MONGO_IP" 27017 2>&1
NC_STATUS=$?
END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
set -e

if [ $NC_STATUS -eq 0 ]; then
  echo "FAILURE: Connection from unlabelled pod to conduit-mongodb succeeded! NetworkPolicy is NOT enforcing isolation."
  exit 1
fi
echo "SUCCESS: Connection blocked (exit code: $NC_STATUS, duration: ${DIFF}s) as enforced by conduit-mongodb NetworkPolicy."

echo ""
echo "--- 2. Testing conduit-mongodb:27017 from gateway pod (expected: ALLOWED / CONNECTED) ---"
kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
const net = require("net");
const s = net.connect(27017, "conduit-mongodb", () => {
  console.log("SUCCESS: Gateway successfully connected to conduit-mongodb:27017 over TCP!");
  s.end();
  process.exit(0);
});
s.setTimeout(3000, () => {
  console.error("FAILURE: Timed out connecting to conduit-mongodb:27017 from gateway!");
  process.exit(1);
});
s.on("error", (err) => {
  console.error("FAILURE: Error connecting to conduit-mongodb:27017 from gateway:", err.message);
  process.exit(1);
});
'

echo ""
echo "--- 3. Testing woo-mcp:3100 from unlabelled pod in default namespace (expected: BLOCKED / TIMEOUT) ---"
set +e
START_TIME=$(date +%s)
kubectl exec -n default unlabelled-default -- nc -zv -w 3 "$WOO_MCP_IP" 3100 2>&1
NC_WOO_STATUS=$?
END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
set -e

if [ $NC_WOO_STATUS -eq 0 ]; then
  echo "FAILURE: Connection from unlabelled pod to woo-mcp succeeded! NetworkPolicy is NOT enforcing isolation."
  exit 1
fi
echo "SUCCESS: Connection blocked (exit code: $NC_WOO_STATUS, duration: ${DIFF}s) as enforced by woo-mcp NetworkPolicy."

echo ""
echo "--- 4. Testing gateway egress to woo-mcp in store-default namespace (expected: 200 OK) ---"
kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
const http = require("http");
http.get("http://store-woocommerce-store-woo-mcp.store-default.svc.cluster.local:3100/healthz", (res) => {
  if (res.statusCode === 200) {
    console.log("SUCCESS: Gateway reached woo-mcp in store-default! Status: 200 OK");
    process.exit(0);
  } else {
    console.error("FAILURE: Unexpected status code from woo-mcp:", res.statusCode);
    process.exit(1);
  }
}).on("error", (e) => {
  console.error("FAILURE: Error reaching woo-mcp from gateway:", e.message);
  process.exit(1);
});
'

echo ""
echo "=== All NetworkPolicy isolation tests passed! ==="
