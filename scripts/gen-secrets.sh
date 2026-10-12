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
  MONGO_ROOT_USER="root"
  MONGO_ROOT_PASSWORD="$(random_hex)"
  MONGO_USER="conduit"
  MONGO_PASSWORD="$(random_hex)"
  MONGO_DB="conduit"
  MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASSWORD}@conduit-mongodb:27017/${MONGO_DB}?authSource=${MONGO_DB}"

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

MONGO_ROOT_USER=${MONGO_ROOT_USER}
MONGO_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD}
MONGO_USER=${MONGO_USER}
MONGO_PASSWORD=${MONGO_PASSWORD}
MONGO_DB=${MONGO_DB}
MONGO_URI=${MONGO_URI}

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
  # Ensure any newly required Mongo variables exist in existing .env
  if ! grep -q "^MONGO_ROOT_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
    NEW_ROOT_PASS="$(random_hex)"
    echo "MONGO_ROOT_USER=root" >> "$ENV_FILE"
    echo "MONGO_ROOT_PASSWORD=${NEW_ROOT_PASS}" >> "$ENV_FILE"
  fi
  if ! grep -q "^MONGO_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
    NEW_APP_PASS="$(random_hex)"
    echo "MONGO_USER=conduit" >> "$ENV_FILE"
    echo "MONGO_PASSWORD=${NEW_APP_PASS}" >> "$ENV_FILE"
    echo "MONGO_DB=conduit" >> "$ENV_FILE"
  fi
  if ! grep -q "^MONGO_URI=" "$ENV_FILE" 2>/dev/null; then
    # Sourced below to compose MONGO_URI
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
    echo "MONGO_URI=mongodb://${MONGO_USER:-conduit}:${MONGO_PASSWORD}@conduit-mongodb:27017/${MONGO_DB:-conduit}?authSource=${MONGO_DB:-conduit}" >> "$ENV_FILE"
  fi
fi

# If kubectl is available and can reach a cluster, create Kubernetes Secrets
if kubectl cluster-info >/dev/null 2>&1; then
  echo "Active Kubernetes cluster detected. Syncing Secrets..."
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a

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
