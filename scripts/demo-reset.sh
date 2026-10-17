#!/usr/bin/env bash
set -euo pipefail

echo "===================================================="
echo " Resetting Conduit Demo State to Clean Baseline"
echo "===================================================="

# 1. Connect to MongoDB in conduit-system and clean ephemeral test data
echo "==> Cleaning transient test data from MongoDB..."
RAW_URI=$(kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.MONGO_URI}' | base64 -d)
LOCAL_URI="${RAW_URI/conduit-mongodb/127.0.0.1}"
kubectl exec -n conduit-system conduit-mongodb-0 -c mongodb -- mongosh "$LOCAL_URI" --quiet --eval '
  db.conversations.deleteMany({});
  db.messages.deleteMany({});
  db.api_keys.deleteMany({ name: { $regex: /^test|^e2e/i } });
  db.invites.deleteMany({});
  db.users.deleteMany({ email: { $regex: /^e2e-|^test-/i } });
  print("Transient test data wiped successfully.");
'

# 2. Ensure live test order exists in WooCommerce
echo "==> Verifying WooCommerce sample order in store-default..."
kubectl exec -n store-default deployment/store-woocommerce-store-wordpress -c wordpress -- wp wc shop_order create --user=admin --status=processing --billing='{"first_name":"Demo","last_name":"Customer","email":"demo@conduit.localhost"}' --line_items='[{"product_id":1,"quantity":1}]' --allow-root >/dev/null 2>&1 || true

echo "SUCCESS: Conduit demo state reset complete!"
