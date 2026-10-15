#!/usr/bin/env bash
set -euo pipefail

# scripts/test-netpol-proof.sh
# Verifies NetworkPolicy isolation and pod-to-pod communication rules.
# Uses dedicated negative-control namespace netpol-test (no policies applied)
# to prove cluster networking works, then asserts strict isolation.

echo "=== NetworkPolicy Isolation Proof for Conduit & WooCommerce Stores ==="

# Ensure netpol-test namespace exists
kubectl create namespace netpol-test --dry-run=client -o yaml | kubectl apply -f -

# Clean any existing test pods
kubectl delete pod test-server test-client -n netpol-test --ignore-not-found --wait=false >/dev/null 2>&1 || true

# Start negative control receiver and client pods in netpol-test
echo "Starting negative-control pods in netpol-test namespace..."
kubectl run test-server -n netpol-test --image=rancher/mirrored-library-busybox:1.37.0 --restart=Always -- nc -lk -p 8080 -e echo "netpol-open"
kubectl run test-client -n netpol-test --image=rancher/mirrored-library-busybox:1.37.0 --restart=Always -- sleep infinity

kubectl wait --for=condition=ready pod/test-server -n netpol-test --timeout=60s
kubectl wait --for=condition=ready pod/test-client -n netpol-test --timeout=60s

SERVER_IP=$(kubectl get pod test-server -n netpol-test -o jsonpath='{.status.podIP}')
GATEWAY_POD=$(kubectl get pods -n conduit-system -l app.kubernetes.io/name=gateway,app.kubernetes.io/component=gateway -o jsonpath='{.items[0].metadata.name}')
WOO_MCP_POD=$(kubectl get pods -n store-default -l app.kubernetes.io/name=woocommerce-store-woo-mcp -o jsonpath='{.items[0].metadata.name}')
DASHBOARD_POD=$(kubectl get pods -n conduit-system -l app.kubernetes.io/name=dashboard,app.kubernetes.io/component=dashboard -o jsonpath='{.items[0].metadata.name}')
MONGO_IP=$(kubectl get svc -n conduit-system conduit-mongodb -o jsonpath='{.spec.clusterIP}')
WOO_MCP_IP=$(kubectl get svc -n store-default store-woocommerce-store-woo-mcp -o jsonpath='{.spec.clusterIP}')

echo "Gateway pod: $GATEWAY_POD"
echo "woo-mcp pod: $WOO_MCP_POD"
echo "conduit-mongodb ClusterIP: $MONGO_IP"
echo "woo-mcp ClusterIP: $WOO_MCP_IP"

cleanup() {
  echo "Cleaning up netpol-test pods..."
  kubectl delete pod test-server test-client -n netpol-test --ignore-not-found --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ""
echo "--- 0. NEGATIVE CONTROL: Testing open pod-to-pod traffic in netpol-test (expected: ALLOWED) ---"
CTRL_OUTPUT=$(timeout 10 kubectl exec -n netpol-test test-client -- nc -w 3 "$SERVER_IP" 8080)
if [[ "$CTRL_OUTPUT" != *"netpol-open"* ]]; then
  echo "FAILURE: Negative control failed! Packet flow in unisolated netpol-test namespace failed."
  exit 1
fi
echo "SUCCESS: Negative control confirmed! Open packet flow succeeds between unisolated pods."

echo ""
echo "--- 1. Testing conduit-mongodb:27017 from external namespace netpol-test (expected: BLOCKED) ---"
set +e
START_TIME=$(date +%s)
timeout 10 kubectl exec -n netpol-test test-client -- nc -zv -w 3 "$MONGO_IP" 27017 2>&1
NC_STATUS=$?
END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
set -e

if [ $NC_STATUS -eq 0 ]; then
  echo "FAILURE: Connection from netpol-test to conduit-mongodb succeeded! NetworkPolicy failed to isolate."
  exit 1
fi
echo "SUCCESS: Connection blocked (exit code: $NC_STATUS, duration: ${DIFF}s) as enforced by conduit-mongodb NetworkPolicy."

echo ""
echo "--- 2. Testing conduit-mongodb:27017 from gateway pod (expected: ALLOWED) ---"
timeout 15 kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
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
echo "--- 3. Testing woo-mcp:3100 from external namespace netpol-test (expected: BLOCKED) ---"
set +e
START_TIME=$(date +%s)
timeout 10 kubectl exec -n netpol-test test-client -- nc -zv -w 3 "$WOO_MCP_IP" 3100 2>&1
NC_CS_STATUS=$?
END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
set -e

if [ $NC_CS_STATUS -eq 0 ]; then
  echo "FAILURE: Connection from netpol-test to woo-mcp succeeded! NetworkPolicy failed to isolate."
  exit 1
fi
echo "SUCCESS: Connection blocked (exit code: $NC_CS_STATUS, duration: ${DIFF}s) as enforced by woo-mcp NetworkPolicy."

echo ""
echo "--- 4. Testing gateway egress to woo-mcp in store-default namespace (expected: ALLOWED / 200 OK) ---"
timeout 15 kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
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
echo "--- 5. Testing woo-mcp to conduit-mongodb:27017 (expected: BLOCKED) ---"
set +e
timeout 10 kubectl exec -n store-default "$WOO_MCP_POD" -- node -e '
const net = require("net");
const s = net.connect(27017, "conduit-mongodb.conduit-system.svc.cluster.local", () => {
  console.error("FAILURE: woo-mcp connected to conduit-mongodb!");
  s.end();
  process.exit(0);
});
s.setTimeout(3000, () => {
  console.log("SUCCESS: Connection timed out as expected.");
  process.exit(1);
});
s.on("error", (e) => {
  console.log("SUCCESS: Connection rejected as expected:", e.message);
  process.exit(1);
});
'
WOO_MONGO_STATUS=$?
set -e

if [ $WOO_MONGO_STATUS -eq 0 ]; then
  echo "FAILURE: woo-mcp was able to reach conduit-mongodb! NetworkPolicy is NOT enforcing isolation."
  exit 1
fi
echo "SUCCESS: woo-mcp to conduit-mongodb connection blocked (exit code: $WOO_MONGO_STATUS)."

echo ""
echo "--- 6. Testing gateway to wordpress:80 in store-default (expected: BLOCKED) ---"
set +e
timeout 10 kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
const net = require("net");
const s = net.connect(80, "store-woocommerce-store-wordpress.store-default.svc.cluster.local", () => {
  console.error("FAILURE: Gateway connected to store wordpress!");
  s.end();
  process.exit(0);
});
s.setTimeout(3000, () => {
  console.log("SUCCESS: Gateway to wordpress connection timed out as expected.");
  process.exit(1);
});
s.on("error", (e) => {
  console.log("SUCCESS: Gateway to wordpress connection rejected as expected:", e.message);
  process.exit(1);
});
'
GW_WP_STATUS=$?
set -e

if [ $GW_WP_STATUS -eq 0 ]; then
  echo "FAILURE: Gateway was able to reach store wordpress! NetworkPolicy is NOT enforcing isolation."
  exit 1
fi
echo "SUCCESS: Gateway to wordpress connection blocked (exit code: $GW_WP_STATUS)."

echo ""
echo "--- 7. Testing dashboard pod egress to conduit-mongodb:27017 (expected: BLOCKED) ---"
set +e
timeout 10 kubectl exec -n conduit-system "$DASHBOARD_POD" -- nc -zv -w 3 "$MONGO_IP" 27017 2>&1
DASH_MONGO_STATUS=$?
set -e

if [ $DASH_MONGO_STATUS -eq 0 ]; then
  echo "FAILURE: Dashboard was able to connect to mongodb! Zero-egress NetworkPolicy is NOT enforced."
  exit 1
fi
echo "SUCCESS: Dashboard pod egress to mongodb blocked (exit code: $DASH_MONGO_STATUS) by zero-egress NetworkPolicy."

echo ""
echo "=== All 8 NetworkPolicy isolation and negative control tests passed successfully! ==="