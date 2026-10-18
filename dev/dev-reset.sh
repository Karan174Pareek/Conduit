#!/usr/bin/env bash
set -euo pipefail

echo "===================================================="
echo " Resetting Conduit Development State to Clean Baseline"
echo "===================================================="

# 1. Connect to MongoDB inside the container using the internal container environment
echo "==> Cleaning transient test data from MongoDB..."
kubectl exec -n conduit-system conduit-mongodb-0 -c mongodb -- bash -c '
  mongosh "$MONGO_URI" --quiet --eval '\''
    db.conversations.deleteMany({});
    db.messages.deleteMany({});
    db.api_keys.deleteMany({ name: { $regex: /^test|^e2e/i } });
    db.invites.deleteMany({});
    db.users.deleteMany({ email: { $regex: /^e2e-|^test-/i } });
    print("Transient test data wiped successfully.");
  '\''
'

echo "SUCCESS: Conduit dev state reset complete!"
