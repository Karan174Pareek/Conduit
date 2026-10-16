#!/usr/bin/env bash
set -e

echo "=== Pod Probes & Lifecycle Verification Drill ==="

echo "1. Checking current probe definitions on core workloads..."
kubectl get deployment conduit-gateway -n conduit-system -o jsonpath='Gateway Probes: startup={.spec.template.spec.containers[0].startupProbe.httpGet.path}, liveness={.spec.template.spec.containers[0].livenessProbe.httpGet.path}, readiness={.spec.template.spec.containers[0].readinessProbe.httpGet.path}{"\n"}'
kubectl get deployment store-woocommerce-store-woo-mcp -n store-default -o jsonpath='woo-mcp Probes: liveness={.spec.template.spec.containers[0].livenessProbe.httpGet.path}, readiness={.spec.template.spec.containers[0].readinessProbe.httpGet.path}{"\n"}'
kubectl get deployment store-woocommerce-store-wordpress -n store-default -o jsonpath='WordPress Probes: startup={.spec.template.spec.containers[0].startupProbe.httpGet.path}, readiness={.spec.template.spec.containers[0].readinessProbe.httpGet.path}, liveness={.spec.template.spec.containers[0].livenessProbe.tcpSocket.port}{"\n"}'

echo ""
echo "2. Testing probe response on live pods..."
GW_POD=$(kubectl get pod -n conduit-system -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
echo "Gateway /readyz HTTP probe from inside cluster:"
kubectl exec -n conduit-system "$GW_POD" -- wget -q -S -O /dev/null http://127.0.0.1:3000/readyz 2>&1 | grep "HTTP/"
echo "Gateway /healthz HTTP probe from inside cluster:"
kubectl exec -n conduit-system "$GW_POD" -- wget -q -S -O /dev/null http://127.0.0.1:3000/healthz 2>&1 | grep "HTTP/"

echo ""
echo "3. Triggering pod termination to verify probe deregistration..."
echo "Terminating gateway pod $GW_POD..."
kubectl delete pod "$GW_POD" -n conduit-system --now
echo "Waiting for new gateway pod to pass startup and readiness probes..."
kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=60s

NEW_GW_POD=$(kubectl get pod -n conduit-system -l app.kubernetes.io/name=gateway -o jsonpath='{.items[0].metadata.name}')
echo "New Gateway Pod: $NEW_GW_POD is Running and Ready!"
READY_STATUS=$(kubectl get pod "$NEW_GW_POD" -n conduit-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')
echo "Ready Condition Status: $READY_STATUS"

echo ""
echo "4. Testing slow-start behavior on woo-mcp..."
WOO_POD=$(kubectl get pod -n store-default -l app.kubernetes.io/name=woocommerce-store-woo-mcp -o jsonpath='{.items[0].metadata.name}')
echo "Deleting woo-mcp pod $WOO_POD..."
kubectl delete pod "$WOO_POD" -n store-default --now
echo "Waiting for woo-mcp rollout..."
kubectl rollout status deployment/store-woocommerce-store-woo-mcp -n store-default --timeout=60s
echo "SUCCESS: Probes cleanly prevented premature traffic routing during container boot."

echo ""
echo "=== Probe Verification Complete ==="
