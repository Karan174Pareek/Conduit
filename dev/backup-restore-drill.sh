#!/usr/bin/env bash
set -euo pipefail

# scripts/backup-restore-drill.sh
# Verifies database backups by restoring latest backup into a temporary database
# directly inside existing database pods (zero throwaway pods), comparing counts,
# and dropping the temporary database. Exits non-zero on mismatch or error.

echo "=== Conduit Automated Backup & Restore Drill ==="

# -------------------------------------------------------------
# 1. MongoDB Backup & Restore Drill
# -------------------------------------------------------------
echo ""
echo "--- 1. Testing MongoDB Restore into 'drill_restore' ---"

MONGO_USER=$(timeout 15 kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.MONGO_ROOT_USER}' | base64 -d)
MONGO_PASS=$(timeout 15 kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.MONGO_ROOT_PASSWORD}' | base64 -d)

timeout 60 kubectl exec -n conduit-system conduit-mongodb-0 -- bash -c "
  set -euo pipefail
  LATEST=\$(ls -t /backups/mongo-*.dump.gz 2>/dev/null | head -n 1)
  if [ -z \"\$LATEST\" ]; then
    echo 'ERROR: No MongoDB backup found in /backups'
    exit 1
  fi
  echo \"Latest MongoDB backup archive: \$LATEST\"

  # Get source collection count
  SOURCE_COUNT=\$(mongosh -u '$MONGO_USER' -p '$MONGO_PASS' --authenticationDatabase admin --quiet --eval \"
    print(db.getSiblingDB('conduit').getCollectionNames().length);
  \")
  echo \"Source database ('conduit') collection count: \$SOURCE_COUNT\"

  # Drop drill_restore if leftover
  mongosh -u '$MONGO_USER' -p '$MONGO_PASS' --authenticationDatabase admin --quiet --eval \"
    db.getSiblingDB('drill_restore').dropDatabase();
  \" >/dev/null

  # Restore latest dump into temporary database drill_restore
  echo \"Restoring into 'drill_restore'...\"
  mongorestore --username='$MONGO_USER' \
               --password='$MONGO_PASS' \
               --authenticationDatabase admin \
               --archive=\"\$LATEST\" \
               --gzip \
               --nsFrom='conduit.*' \
               --nsTo='drill_restore.*' \
               --quiet

  # Verify collection count
  RESTORED_COUNT=\$(mongosh -u '$MONGO_USER' -p '$MONGO_PASS' --authenticationDatabase admin --quiet --eval \"
    print(db.getSiblingDB('drill_restore').getCollectionNames().length);
  \")
  echo \"Restored database ('drill_restore') collection count: \$RESTORED_COUNT\"

  # Cleanup temporary database
  mongosh -u '$MONGO_USER' -p '$MONGO_PASS' --authenticationDatabase admin --quiet --eval \"
    db.getSiblingDB('drill_restore').dropDatabase();
  \" >/dev/null

  if [ \"\$SOURCE_COUNT\" -eq 0 ] || [ \"\$SOURCE_COUNT\" -ne \"\$RESTORED_COUNT\" ]; then
    echo \"FAILURE: MongoDB collection count mismatch: source=\$SOURCE_COUNT, restored=\$RESTORED_COUNT\"
    exit 1
  fi
  echo \"SUCCESS: MongoDB restore drill passed (\$RESTORED_COUNT collections matched).\"
"

# -------------------------------------------------------------
# 2. MariaDB Backup & Restore Drill
# -------------------------------------------------------------
echo ""
echo "--- 2. Testing MariaDB Restore into 'drill_restore' ---"

MARIA_PASS=$(timeout 15 kubectl get secret store-secrets -n store-default -o jsonpath='{.data.MARIADB_ROOT_PASSWORD}' | base64 -d)

timeout 60 kubectl exec -n store-default store-woocommerce-store-mariadb-0 -- bash -c "
  set -euo pipefail
  LATEST=\$(ls -t /backups/mariadb-*.sql 2>/dev/null | head -n 1)
  if [ -z \"\$LATEST\" ]; then
    echo 'ERROR: No MariaDB backup found in /backups'
    exit 1
  fi
  echo \"Latest MariaDB backup archive: \$LATEST\"

  # Get source table count
  SOURCE_COUNT=\$(mariadb -u root -p'$MARIA_PASS' -N -e \"SELECT count(*) FROM information_schema.tables WHERE table_schema='wordpress';\")
  echo \"Source database ('wordpress') table count: \$SOURCE_COUNT\"

  # Recreate temporary database drill_restore
  mariadb -u root -p'$MARIA_PASS' -e \"DROP DATABASE IF EXISTS drill_restore; CREATE DATABASE drill_restore;\"

  # Import dump into drill_restore
  echo \"Restoring into 'drill_restore'...\"
  mariadb -u root -p'$MARIA_PASS' drill_restore < \"\$LATEST\"

  # Verify table count
  RESTORED_COUNT=\$(mariadb -u root -p'$MARIA_PASS' -N -e \"SELECT count(*) FROM information_schema.tables WHERE table_schema='drill_restore';\")
  echo \"Restored database ('drill_restore') table count: \$RESTORED_COUNT\"

  # Cleanup temporary database
  mariadb -u root -p'$MARIA_PASS' -e \"DROP DATABASE drill_restore;\"

  if [ \"\$SOURCE_COUNT\" -eq 0 ] || [ \"\$SOURCE_COUNT\" -ne \"\$RESTORED_COUNT\" ]; then
    echo \"FAILURE: MariaDB table count mismatch: source=\$SOURCE_COUNT, restored=\$RESTORED_COUNT\"
    exit 1
  fi
  echo \"SUCCESS: MariaDB restore drill passed (\$RESTORED_COUNT tables matched).\"
"

echo ""
echo "=== All Backup and Restore Drills Passed Successfully! ==="