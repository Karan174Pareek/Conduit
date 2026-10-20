#!/usr/bin/env bash
set -euo pipefail

# scripts/gen-secrets.sh
# Generates local .env with cryptographically random secrets if not present,
# reads existing .env and fills ONLY missing values without overwriting or losing GEMINI_API_KEY,
# and optionally provisions Kubernetes Secrets when connected to a cluster.

ENV_FILE="${ENV_FILE:-.env}"

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

# Helper to ensure a variable exists in $ENV_FILE without modifying existing value
ensure_var() {
  local var_name="$1"
  local default_val="$2"
  if ! grep -q "^${var_name}=" "$ENV_FILE" 2>/dev/null; then
    echo "${var_name}=${default_val}" >> "$ENV_FILE"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Generating fresh $ENV_FILE with secure random secrets..."
  touch "$ENV_FILE"
else
  echo "$ENV_FILE already exists, preserving existing values and filling missing secrets..."
fi

# Ensure URLs & Origins
ensure_var "PUBLIC_DASHBOARD_URL" "http://dashboard.localhost"
ensure_var "PUBLIC_GATEWAY_URL" "http://gateway.localhost"
ensure_var "PUBLIC_SHOP_URL" "http://shop.localhost"
ensure_var "ALLOWED_ORIGINS" "http://dashboard.localhost"

# Ensure security keys
ensure_var "SESSION_SECRET" "$(random_hex)"
ensure_var "API_KEY_PEPPER" "$(random_hex)"
ensure_var "CREDENTIAL_ENC_KEYS" "kid1:$(random_base64)"

# Ensure bootstrap admin
ensure_var "BOOTSTRAP_ADMIN_EMAIL" "admin@conduit.localhost"
ensure_var "BOOTSTRAP_ADMIN_PASSWORD" "$(random_hex)"

# Ensure GEMINI_API_KEY (never overwrite if present, defaults to empty or env if absent)
ensure_var "GEMINI_API_KEY" "${GEMINI_API_KEY:-}"
ensure_var "GEMINI_MODEL" "gemini-3.8-flash"

# Ensure MongoDB credentials
ensure_var "MONGO_ROOT_USER" "root"
ensure_var "MONGO_ROOT_PASSWORD" "$(random_hex)"
ensure_var "MONGO_USER" "conduit"
ensure_var "MONGO_PASSWORD" "$(random_hex)"
ensure_var "MONGO_DB" "conduit"

# Source to safely build MONGO_URI if missing
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

ensure_var "MONGO_URI" "mongodb://${MONGO_USER}:${MONGO_PASSWORD}@conduit-mongodb:27017/${MONGO_DB}?authSource=${MONGO_DB}"

# Ensure Woo & MariaDB secrets
ensure_var "WOO_MCP_BEARER_TOKEN" "$(random_hex)"
ensure_var "MARIADB_ROOT_PASSWORD" "$(random_hex)"
ensure_var "MARIADB_PASSWORD" "$(random_hex)"
ensure_var "WP_ADMIN_PASSWORD" "$(random_hex)"
ensure_var "WP_CONSUMER_KEY" "ck_$(random_hex | head -c 40)"
ensure_var "WP_CONSUMER_SECRET" "cs_$(random_hex | head -c 40)"

# Re-source after ensuring all variables
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# If kubectl is available and can reach a cluster, create Kubernetes Secrets
if kubectl cluster-info >/dev/null 2>&1; then
  echo "Active Kubernetes cluster detected. Syncing Secrets..."

  kubectl create namespace conduit-system --dry-run=client -o yaml | kubectl apply -f -
  kubectl label namespace conduit-system \
    pod-security.kubernetes.io/enforce=restricted \
    pod-security.kubernetes.io/enforce-version=latest \
    pod-security.kubernetes.io/audit=restricted \
    pod-security.kubernetes.io/audit-version=latest \
    pod-security.kubernetes.io/warn=restricted \
    pod-security.kubernetes.io/warn-version=latest \
    --overwrite

  kubectl create namespace store-default --dry-run=client -o yaml | kubectl apply -f -

  kubectl create secret generic conduit-secrets \
    --namespace conduit-system \
    --from-literal=SESSION_SECRET="${SESSION_SECRET}" \
    --from-literal=API_KEY_PEPPER="${API_KEY_PEPPER}" \
    --from-literal=CREDENTIAL_ENC_KEYS="${CREDENTIAL_ENC_KEYS}" \
    --from-literal=BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD}" \
    --from-literal=GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
    --from-literal=WOO_MCP_BEARER_TOKEN="${WOO_MCP_BEARER_TOKEN}" \
    --from-literal=MONGO_ROOT_USER="${MONGO_ROOT_USER:-root}" \
    --from-literal=MONGO_ROOT_PASSWORD="${MONGO_ROOT_PASSWORD}" \
    --from-literal=MONGO_USER="${MONGO_USER:-conduit}" \
    --from-literal=MONGO_PASSWORD="${MONGO_PASSWORD}" \
    --from-literal=MONGO_DB="${MONGO_DB:-conduit}" \
    --from-literal=MONGO_URI="${MONGO_URI}" \
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
