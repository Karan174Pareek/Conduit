#!/usr/bin/env bash
set -euo pipefail

# scripts/cluster-up.sh
# Creates the local k3d cluster with Traefik ingress mapped to host port 80,
# generates dev secrets, and verifies ingress with a throwaway whoami deployment.

CLUSTER_NAME="conduit"
PUBLIC_PORT="${PUBLIC_PORT:-80}"

echo "=== Conduit Local Cluster Setup (k3d) ==="

# Check if Docker daemon is responsive
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running!" >&2
  echo "Please start Docker Desktop on Windows / WSL2 and run this script again." >&2
  exit 1
fi

# Check if cluster already exists
if k3d cluster list | grep -q "^${CLUSTER_NAME}\b"; then
  echo "k3d cluster '${CLUSTER_NAME}' already exists. Switching kubeconfig context..."
  kubectl config use-context "k3d-${CLUSTER_NAME}"
else
  echo "Creating k3d cluster '${CLUSTER_NAME}' on port ${PUBLIC_PORT}..."
  k3d cluster create "${CLUSTER_NAME}" \
    --servers 1 \
    -p "${PUBLIC_PORT}:80@loadbalancer" \
    --k3s-arg "--disable=metrics-server@server:0"
fi

# Ensure namespaces exist
kubectl create namespace conduit-system --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace store-default --dry-run=client -o yaml | kubectl apply -f -

# Generate and sync local development secrets
"$(dirname "$0")/gen-secrets.sh"

echo "Deploying throwaway 'whoami' service to verify Traefik ingress..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whoami
  namespace: default
  labels:
    app: whoami
spec:
  replicas: 1
  selector:
    matchLabels:
      app: whoami
  template:
    metadata:
      labels:
        app: whoami
    spec:
      containers:
      - name: whoami
        image: traefik/whoami:latest
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: whoami
  namespace: default
spec:
  ports:
  - port: 80
    targetPort: 80
  selector:
    app: whoami
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: whoami
  namespace: default
spec:
  ingressClassName: traefik
  rules:
  - host: whoami.localhost
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: whoami
            port:
              number: 80
EOF

echo "Waiting for whoami deployment rollout..."
kubectl rollout status deployment/whoami -n default --timeout=90s

echo "Verifying HTTP reachability via Traefik (http://whoami.localhost)..."
if curl -s -f --max-time 10 http://whoami.localhost >/dev/null; then
  echo "SUCCESS: http://whoami.localhost is reachable through Traefik!"
else
  echo "WARNING: Direct curl to http://whoami.localhost did not respond."
  echo "Testing via loopback with Host header: curl -H 'Host: whoami.localhost' http://127.0.0.1:${PUBLIC_PORT}"
  curl -s -f --max-time 10 -H "Host: whoami.localhost" "http://127.0.0.1:${PUBLIC_PORT}"
  echo "SUCCESS: Host header routing to Traefik succeeded!"
fi

echo "=== Cluster ${CLUSTER_NAME} is UP and READY ==="
