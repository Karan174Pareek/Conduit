#!/usr/bin/env bash
set -e

echo "=== NetworkPolicy Isolation Proof for Conduit & WooCommerce Stores ==="

# 1. Ensure unlabelled pod in default namespace
if ! kubectl get pod -n default unlabelled-default >/dev/null 2>&1; then
  echo "Starting unlabelled pod in namespace default..."
  kubectl run unlabelled-default -n default --image=rancher/mirrored-library-busybox:1.37.0 --restart=Always -- sleep infinity
  kubectl wait --for=condition=ready pod/unlabelled-default -n default --timeout=30s
fi

# 2. Ensure unlabelled pod in conduit-system namespace
if ! kubectl get pod -n conduit-system unlabelled-debug >/dev/null 2>&1; then
  echo "Starting unlabelled pod in namespace conduit-system..."
  kubectl run unlabelled-debug -n conduit-system --image=rancher/mirrored-library-busybox:1.37.0 --restart=Always -- sleep infinity
  kubectl wait --for=condition=ready pod/unlabelled-debug -n conduit-system --timeout=30s
fi

GATEWAY_POD=$(kubectl get pods -n conduit-system -l app.kubernetes.io/name=gateway,app.kubernetes.io/component=gateway -o jsonpath='{.items[0].metadata.name}')
echo "Gateway pod: $GATEWAY_POD"

WOO_MCP_POD=$(kubectl get pods -n store-default -l app.kubernetes.io/name=woocommerce-store-woo-mcp -o jsonpath='{.items[0].metadata.name}')
echo "woo-mcp pod: $WOO_MCP_POD"

MONGO_IP=$(kubectl get svc -n conduit-system conduit-mongodb -o jsonpath='{.spec.clusterIP}')
echo "conduit-mongodb ClusterIP: $MONGO_IP"

WOO_MCP_IP=$(kubectl get svc -n store-default store-woocommerce-store-woo-mcp -o jsonpath='{.spec.clusterIP}')
echo "woo-mcp ClusterIP: $WOO_MCP_IP"

echo ""
echo "--- 1. Testing conduit-mongodb:27017 from unlabelled pod in default namespace (expected: BLOCKED) ---"
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
echo "--- 2. Testing conduit-mongodb:27017 from gateway pod (expected: ALLOWED) ---"
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
echo "--- 3. Testing woo-mcp:3100 from unlabelled pod in conduit-system (expected: BLOCKED) ---"
set +e
START_TIME=$(date +%s)
kubectl exec -n conduit-system unlabelled-debug -- nc -zv -w 3 "$WOO_MCP_IP" 3100 2>&1
NC_CS_STATUS=$?
END_TIME=$(date +%s)
DIFF=$((END_TIME - START_TIME))
set -e

if [ $NC_CS_STATUS -eq 0 ]; then
  echo "FAILURE: Connection from unlabelled pod in conduit-system to woo-mcp succeeded! NetworkPolicy is NOT enforcing isolation."
  exit 1
fi
echo "SUCCESS: Connection blocked (exit code: $NC_CS_STATUS, duration: ${DIFF}s) as enforced by woo-mcp NetworkPolicy."

echo ""
echo "--- 4. Testing gateway egress to woo-mcp in store-default namespace (expected: ALLOWED / 200 OK) ---"
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
echo "--- 5. Testing woo-mcp to conduit-mongodb:27017 (expected: BLOCKED) ---"
set +e
kubectl exec -n store-default "$WOO_MCP_POD" -- node -e '
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
kubectl exec -n conduit-system "$GATEWAY_POD" -- node -e '
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
echo "=== All 6 NetworkPolicy isolation tests passed successfully! ==="
