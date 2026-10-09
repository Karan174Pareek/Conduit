#!/usr/bin/env bash
set -euo pipefail

# scripts/cluster-down.sh
# Teardown local k3d cluster

CLUSTER_NAME="conduit"

echo "=== Tearing down k3d cluster '${CLUSTER_NAME}' ==="

if k3d cluster list | grep -q "^${CLUSTER_NAME}\b"; then
  k3d cluster delete "${CLUSTER_NAME}"
  echo "Cluster '${CLUSTER_NAME}' deleted successfully."
else
  echo "Cluster '${CLUSTER_NAME}' does not exist."
fi
