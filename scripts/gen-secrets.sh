#!/usr/bin/env bash
set -euo pipefail

# scripts/gen-secrets.sh
# Generates local .env with cryptographically random secrets if not present,
# and optionally provisions Kubernetes Secrets when connected to a cluster.

ENV_FILE=".env"

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | xxd -p -c 32
  fi
}

random_base64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32
  else
    head -c 32 /dev/urandom | base64
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Generating fresh $ENV_FILE with secure random secrets..."
  
  SESSION_SECRET="$(random_hex)"
  API_KEY_PEPPER="$(random_hex)"
  ENC_KEY_B64="$(random_base64)"
  ADMIN_PASSWORD="$(random_hex)"
  WOO_BEARER="$(random_hex)"
  MARIADB_ROOT_PASSWORD="$(random_hex)"
  MARIADB_PASSWORD="$(random_hex)"
  WP_ADMIN_PASSWORD="$(random_hex)"
  WP_CONSUMER_KEY="ck_$(random_hex | cut -c1-32)"
  WP_CONSUMER_SECRET="cs_$(random_hex | cut -c1-32)"

  cat <<EOF > "$ENV_FILE"
# Generated local secrets for Conduit dev environment
PUBLIC_DASHBOARD_URL=http://dashboard.localhost
PUBLIC_GATEWAY_URL=http://gateway.localhost
PUBLIC_SHOP_URL=http://shop.localhost
ALLOWED_ORIGINS=http://dashboard.localhost

SESSION_SECRET=${SESSION_SECRET}
API_KEY_PEPPER=${API_KEY_PEPPER}
CREDENTIAL_ENC_KEYS=kid1:${ENC_KEY_B64}

BOOTSTRAP_ADMIN_EMAIL=admin@conduit.localhost
BOOTSTRAP_ADMIN_PASSWORD=${ADMIN_PASSWORD}

GEMINI_API_KEY=\${GEMINI_API_KEY:-}
GEMINI_MODEL=gemini-2.5-flash

WOO_MCP_BEARER_TOKEN=${WOO_BEARER}

MARIADB_ROOT_PASSWORD=${MARIADB_ROOT_PASSWORD}
MARIADB_PASSWORD=${MARIADB_PASSWORD}
WP_ADMIN_PASSWORD=${WP_ADMIN_PASSWORD}
WP_CONSUMER_KEY=${WP_CONSUMER_KEY}
WP_CONSUMER_SECRET=${WP_CONSUMER_SECRET}
EOF
  echo "$ENV_FILE created successfully."
else
  echo "$ENV_FILE already exists, preserving existing values."
fi

# If kubectl is available and can reach a cluster, create Kubernetes Secrets
if kubectl cluster-info >/dev/null 2>&1; then
  echo "Active Kubernetes cluster detected. Syncing Secrets..."
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

  kubectl create namespace conduit-system --dry-run=client -o yaml | kubectl apply -f -
  kubectl create namespace store-default --dry-run=client -o yaml | kubectl apply -f -

  kubectl create secret generic conduit-secrets \
    --namespace conduit-system \
    --from-literal=SESSION_SECRET="${SESSION_SECRET}" \
    --from-literal=API_KEY_PEPPER="${API_KEY_PEPPER}" \
    --from-literal=CREDENTIAL_ENC_KEYS="${CREDENTIAL_ENC_KEYS}" \
    --from-literal=BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD}" \
    --from-literal=GEMINI_API_KEY="${GEMINI_API_KEY:-dummy-key}" \
    --from-literal=WOO_MCP_BEARER_TOKEN="${WOO_MCP_BEARER_TOKEN}" \
    --dry-run=client -o yaml | kubectl apply -f -

  kubectl create secret generic store-secrets \
    --namespace store-default \
    --from-literal=MARIADB_ROOT_PASSWORD="${MARIADB_ROOT_PASSWORD}" \
    --from-literal=MARIADB_PASSWORD="${MARIADB_PASSWORD}" \
    --from-literal=WP_ADMIN_PASSWORD="${WP_ADMIN_PASSWORD}" \
    --from-literal=WP_CONSUMER_KEY="${WP_CONSUMER_KEY}" \
    --from-literal=WP_CONSUMER_SECRET="${WP_CONSUMER_SECRET}" \
    --from-literal=WOO_MCP_BEARER_TOKEN="${WOO_MCP_BEARER_TOKEN}" \
    --dry-run=client -o yaml | kubectl apply -f -

  echo "Kubernetes Secrets conduit-secrets and store-secrets synchronized successfully."
else
  echo "No active Kubernetes cluster connected; skipped in-cluster Secret creation."
fi
