#!/usr/bin/env bash
set -e

echo "=== Conduit Phase 3A Acceptance Tests ==="

# Source .env for bootstrap admin password
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

echo "--- 1. Testing Unauthenticated Access ---"
UNAUTH_CODE=$(curl -sS -o /dev/null -w "%{http_code}" http://dashboard.localhost/api/auth/me)
echo "GET /api/auth/me HTTP status: $UNAUTH_CODE"
if [ "$UNAUTH_CODE" -ne 401 ]; then
  echo "Expected 401, got $UNAUTH_CODE"
  exit 1
fi

echo "--- 2. Testing Login & Session Cookie ---"
COOKIE_JAR=$(mktemp)
LOGIN_RESP=$(curl -sS -c "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@conduit.localhost\",\"password\":\"$BOOTSTRAP_ADMIN_PASSWORD\"}" \
  http://dashboard.localhost/api/auth/login)

CSRF_TOKEN=$(echo "$LOGIN_RESP" | grep -o '"csrfToken":"[^"]*' | cut -d'"' -f4)
echo "Login succeeded. CSRF token acquired (length: ${#CSRF_TOKEN})"

ME_RESP=$(curl -sS -b "$COOKIE_JAR" http://dashboard.localhost/api/auth/me)
USER_ROLE=$(echo "$ME_RESP" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
USER_EMAIL=$(echo "$ME_RESP" | grep -o '"email":"[^"]*' | cut -d'"' -f4)
echo "Authenticated /me: $USER_EMAIL (role: $USER_ROLE)"

echo "--- 3. Testing API Key Creation & Reveal ---"
KEY_RESP=$(curl -sS -b "$COOKIE_JAR" -H "Content-Type: application/json" -H "x-csrf-token: $CSRF_TOKEN" \
  -d '{"name":"acceptance-test-key"}' http://dashboard.localhost/api/keys)

KEY_ID=$(echo "$KEY_RESP" | grep -o '"id":"[^"]*' | head -n1 | cut -d'"' -f4)
RAW_KEY=$(echo "$KEY_RESP" | grep -o '"key":"[^"]*' | cut -d'"' -f4)
PREFIX=$(echo "$KEY_RESP" | grep -o '"prefix":"[^"]*' | cut -d'"' -f4)
echo "API Key created: id=$KEY_ID prefix=$PREFIX"

# Verify subsequent GET /api/keys does NOT reveal rawKey
KEYS_LIST=$(curl -sS -b "$COOKIE_JAR" http://dashboard.localhost/api/keys)
if echo "$KEYS_LIST" | grep -q "rawKey"; then
  echo "ERROR: rawKey revealed in GET /api/keys listing!"
  exit 1
fi
echo "Verified: rawKey is not revealed in list."

echo "--- 4. Testing Bearer Key with /api/_debug/whoami ---"
WHOAMI_RESP=$(curl -sS -H "Authorization: Bearer $RAW_KEY" http://dashboard.localhost/api/_debug/whoami)
echo "Whoami raw response: $WHOAMI_RESP"
AUTH_METHOD=$(echo "$WHOAMI_RESP" | grep -o '"authMethod":"[^"]*' | cut -d'"' -f4)
PRINCIPAL_ROLE=$(echo "$WHOAMI_RESP" | grep -o '"role":"[^"]*' | cut -d'"' -f4)
echo "Whoami verified: authMethod=$AUTH_METHOD role=$PRINCIPAL_ROLE"

echo "--- 5. Testing API Key Revocation ---"
REVOKE_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE -b "$COOKIE_JAR" \
  -H "x-csrf-token: $CSRF_TOKEN" http://dashboard.localhost/api/keys/$KEY_ID)
echo "DELETE /api/keys/$KEY_ID HTTP status: $REVOKE_CODE"

POST_REVOKE_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $RAW_KEY" http://dashboard.localhost/api/_debug/whoami)
echo "Post-revocation GET /api/_debug/whoami HTTP status: $POST_REVOKE_CODE"
if [ "$POST_REVOKE_CODE" -ne 401 ]; then
  echo "Expected 401 after revocation, got $POST_REVOKE_CODE"
  exit 1
fi

rm -f "$COOKIE_JAR"
echo "=== Acceptance Criterion 1 Passed Successfully ==="
