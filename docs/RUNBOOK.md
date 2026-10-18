# Conduit — Operations & Incident Response Runbook

This runbook defines operational procedures, secret rotation routines, backup and restore drills, scaling instructions, and incident response playbooks for the Conduit production environment.

---

## 1. Secret Rotation Procedures

### 1.1 Credential Encryption Keys (`CREDENTIAL_ENC_KEYS`)
`CREDENTIAL_ENC_KEYS` encrypts upstream server credentials (e.g. WooCommerce REST credentials, bearer tokens) at rest in MongoDB using AES-256-GCM.
- **Rotation Frequency**: Every 90 days, or immediately following an operator credential compromise.
- **Downtime**: Zero downtime. The gateway supports multi-key configuration via Key Identifiers (`kid`).

#### Step-by-Step Rotation:
1. **Generate a new 32-byte Base64 key**:
   ```bash
   NEW_KID="k$(date +%Y%m%d)"
   NEW_KEY=$(openssl rand -base64 32)
   echo "New Key: ${NEW_KID}:${NEW_KEY}"
   ```
2. **Prepend the new key to `CREDENTIAL_ENC_KEYS`**:
   Format: `<active_new_kid>:<key_b64>,<old_kid>:<old_key_b64>`
   - The first key in the comma-separated list is the **active encryption key**.
   - Subsequent keys are retained for decryption.
3. **Update the Kubernetes Secret**:
   ```bash
   kubectl set data secret conduit-secrets -n conduit-system \
     CREDENTIAL_ENC_KEYS="$(echo -n "${NEW_KID}:${NEW_KEY},${OLD_KEYS}" | base64 -w0)"
   ```
4. **Trigger Gateway Rolling Restart**:
   ```bash
   kubectl rollout restart deployment/conduit-gateway -n conduit-system
   kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=120s
   ```
5. **Run the Idempotent Database Re-Encryption Script**:
   Execute the migration script to re-encrypt all stored credentials with the new primary key:
   ```bash
   npx tsx dev/rotate-credentials.ts
   ```
   *Output will confirm: "All upstream credentials successfully re-encrypted with active key."*
6. **Retire the Old Key**:
   Once re-encryption is verified, remove the old key from `CREDENTIAL_ENC_KEYS` in Kubernetes Secrets and redeploy.

---

### 1.2 API Key Pepper Rotation (`API_KEY_PEPPER`)
`API_KEY_PEPPER` provides the secret key used by HMAC-SHA256 to hash member API keys (`mcpgw_...`).
- **Impact of Rotation**: **All existing member API keys will be immediately invalidated.** Team members must generate new API keys from the Dashboard or via admin invites.
- **Procedure**:
  1. Notify team members of scheduled API key rollover.
  2. Generate a new 32-byte secret pepper:
     ```bash
     NEW_PEPPER=$(openssl rand -base64 32)
     ```
  3. Update `API_KEY_PEPPER` in `conduit-secrets`:
     ```bash
     kubectl set data secret conduit-secrets -n conduit-system \
       API_KEY_PEPPER="$(echo -n "${NEW_PEPPER}" | base64 -w0)"
     ```
  4. Rolling restart the gateway:
     ```bash
     kubectl rollout restart deployment/conduit-gateway -n conduit-system
     ```
  5. Members log in to the Dashboard and generate new API keys under **Account > API Keys**.

---

### 1.3 Session Secret Rotation (`SESSION_SECRET`)
`SESSION_SECRET` signs encrypted browser session cookies.
- **Impact of Rotation**: All active web dashboard sessions will terminate; users will be required to log in again.
- **Procedure**:
  1. Generate new random 32-byte secret:
     ```bash
     NEW_SESSION_SECRET=$(openssl rand -hex 32)
     ```
  2. Update `SESSION_SECRET` in `conduit-secrets` and restart the gateway.

---

## 2. Backup and Disaster Recovery

### 2.1 MongoDB Automated Backup Procedure
MongoDB runs as a StatefulSet (`conduit-mongodb-0`). Automated daily backups are scheduled via Kubernetes CronJob (`conduit-mongodb-backup`).
- **Manual Backup Trigger**:
  ```bash
  kubectl create job --from=cronjob/conduit-mongodb-backup manual-mongo-backup -n conduit-system
  kubectl wait --for=condition=complete job/manual-mongo-backup -n conduit-system --timeout=120s
  ```
- **Dump Inspection**:
  Backups are stored in the mounted Persistent Volume Claim (`conduit-mongodb-backup-pvc`) using `mongodump` with compression.

### 2.2 MariaDB Store Automated Backup Procedure
MariaDB stores WordPress and WooCommerce state in `store-woocommerce-store-mariadb-0`.
- **Manual Backup Trigger**:
  ```bash
  kubectl create job --from=cronjob/store-mariadb-backup manual-store-backup -n store-default
  kubectl wait --for=condition=complete job/manual-store-backup -n store-default --timeout=120s
  ```

### 2.3 Restore Drill (Tested Verification)
To restore MongoDB from an archive:
1. Scale down the gateway to pause active writes:
   ```bash
   kubectl scale deployment/conduit-gateway -n conduit-system --replicas=0
   ```
2. Execute `mongorestore` from the backup pod or volume:
   ```bash
   kubectl exec -n conduit-system conduit-mongodb-0 -c mongodb -- \
     mongorestore --drop --gzip --archive=/backups/conduit-backup-latest.gz
   ```
3. Scale the gateway back up:
   ```bash
   kubectl scale deployment/conduit-gateway -n conduit-system --replicas=2
   ```

---

## 3. Incident Response Playbooks

### 3.1 Leaked Member API Key
- **Indicator**: Unauthorized tool execution in audit logs, unusual user agent, or external leak report.
- **Action**:
  1. Immediately navigate to **Admin Dashboard > API Keys** (or invoke admin API):
     ```bash
     # Emergency Revocation via Admin API
     curl -X POST http://gateway.localhost/api/keys/<KEY_ID>/revoke \
       -H "Cookie: conduit_session=..."
     ```
  2. Verify revocation in audit logs:
     ```bash
     # Revoked keys are rejected with HTTP 401 Unauthorized immediately
     ```
  3. Inspect audit trail for actions executed using the compromised key:
     Query `/api/audit` filtered by the affected `keyId`.

### 3.2 Compromised Upstream Server
- **Indicator**: Upstream server begins returning unexpected error payloads, attempting SSRF probing, or modifying tool schemas unexpectedly.
- **Action**:
  1. Immediately disable the upstream server in the dashboard:
     ```bash
     curl -X PATCH http://gateway.localhost/api/servers/<SERVER_ID> \
       -H "Content-Type: application/json" \
       -d '{"enabled": false}'
     ```
  2. Disabling an upstream server instantly purges its tools from the gateway's `tools/list` across all connected clients.
  3. Check the audit log to determine if any malicious calls were placed:
     Filter `/api/audit` by `serverSlug`.

### 3.3 Leaked Infrastructure Credentials (e.g. Gemini LLM Key)
- **Indicator**: Leaked key notification from cloud provider or security scanner.
- **Action**:
  1. Generate a new API key in the provider console (e.g. Google AI Studio).
  2. Update Kubernetes Secret:
     ```bash
     kubectl set data secret conduit-secrets -n conduit-system \
       GEMINI_API_KEY="$(echo -n "${NEW_GEMINI_KEY}" | base64 -w0)"
     ```
  3. Rolling restart gateway:
     ```bash
     kubectl rollout restart deployment/conduit-gateway -n conduit-system
     ```
  4. Immediately revoke the old key in the provider console.

---

## 4. Scaling and Capacity Planning

| Component | Default Replicas | Min / Max (HPA) | Metric Target |
|---|---|---|---|
| `conduit-gateway` | 2 | 2 / 10 | CPU > 70%, Concurrency > 50 |
| `conduit-dashboard` | 2 | 2 / 5 | CPU > 80% |
| `notes-mcp` | 1 (Stateful / PVC) | 1 | N/A (Atomic persistent file store) |
| `utils-mcp` | 2 | 2 / 8 | CPU > 70% |
| `woo-mcp` | 2 | 2 / 6 | CPU > 75% |

- **Scaling Command**:
  ```bash
  kubectl scale deployment/conduit-gateway -n conduit-system --replicas=4
  ```

---

## 5. Common Failures & Diagnostic Playbook

### 5.1 Upstream Marked as `unreachable`
- **Root Cause**: Upstream pod crashed, network policy blocked connection, or SSRF filter rejected target address.
- **Diagnostics**:
  ```bash
  # Check upstream pod status
  kubectl get pods -n conduit-system
  kubectl get pods -n store-default
  
  # Inspect gateway logs for SSRF or connection timeouts
  kubectl logs -n conduit-system -l app.kubernetes.io/name=gateway --tail=100 | grep "upstream"
  ```
- **Resolution**:
  Ensure the upstream hostname matches the `SSRF_ALLOWLIST_HOSTS` configured in Helm (`*.svc.cluster.local`).

### 5.2 Bootstrap Admin Login Returns HTTP 403 `password_change_required`
- **Root Cause**: Fresh cluster deployment sets `mustChangePassword: true` on bootstrap admin by security policy.
- **Resolution**:
  Log in via the Dashboard. You will be automatically redirected to `/change-password`. Set a new compliant password (minimum 12 characters).
