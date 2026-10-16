#!/usr/bin/env bash
set -euo pipefail

# scripts/cluster-up.sh
# Creates the local k3d cluster with Traefik ingress mapped to host port 80,
# generates dev secrets, configures namespaces with PSS labels, and ensures metrics-server is active.

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
    -p "${PUBLIC_PORT}:80@loadbalancer"
fi

# Ensure namespaces exist with Pod Security Standards labels (SECURITY.md §7)
kubectl create namespace conduit-system --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace conduit-system --overwrite \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted

kubectl create namespace store-default --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace store-default --overwrite \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=baseline \
  pod-security.kubernetes.io/warn=baseline

# Dedicated negative-control namespace (no network policies)
kubectl create namespace netpol-test --dry-run=client -o yaml | kubectl apply -f -
kubectl label namespace netpol-test --overwrite \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/enforce-version=latest \
  pod-security.kubernetes.io/audit=baseline \
  pod-security.kubernetes.io/warn=baseline

# Ensure metrics-server is deployed for HPA and resource tracking
if ! kubectl get deployment metrics-server -n kube-system >/dev/null 2>&1; then
  echo "Deploying metrics-server into kube-system..."
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/download/v0.7.2/components.yaml
  # Note: --kubelet-insecure-tls is strictly local-only for k3d self-signed kubelet certs; omit in production
  kubectl patch deployment metrics-server -n kube-system --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
fi

# Generate and sync local development secrets
"$(dirname "$0")/gen-secrets.sh"

echo "=== Cluster ${CLUSTER_NAME} is UP and READY ==="