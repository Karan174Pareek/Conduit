# Deploying Conduit on a Single-Node k3s Production VPS

This guide provides an end-to-end operational walkthrough for provisioning, hardening, deploying, and maintaining Conduit on a single-node Linux VPS running **k3s**.

---

## 1. Host Hardening & k3s Installation

### 1.1 Server Prerequisites
- **Recommended OS**: Ubuntu 24.04 LTS (x86_64 or arm64)
- **Minimum Specs**: 4 vCPU, 8 GB RAM, 60 GB NVMe SSD
- **Network Ports**: Inbound 80/tcp (HTTP), 443/tcp (HTTPS), 22/tcp (SSH)

### 1.2 Firewall Configuration (UFW)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP / Let’s Encrypt'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw enable
```

### 1.3 k3s Installation with In-Tree Secrets Encryption
Install k3s with built-in Kubernetes Secrets encryption at rest enabled:
```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server \
  --secrets-encryption \
  --disable=servicelb \
  --write-kubeconfig-mode=644" sh -
```
Verify encryption at rest is active:
```bash
sudo k3s secrets-encrypt status
```

---

## 2. DNS, cert-manager & GHCR Setup

### 2.1 Public DNS Records
Configure A records pointing your production domain to the VPS public IP:
- `conduit.yourdomain.com` (Dashboard)
- `gateway.yourdomain.com` (MCP Front Door & API)
- `shop.yourdomain.com` (Storefront & WordPress Admin)

### 2.2 Install cert-manager
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.17.1/cert-manager.yaml
```

Create Let's Encrypt Production ClusterIssuer:
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@yourdomain.com
    privateKeySecretRef:
      name: letsencrypt-prod-account-key
    solvers:
      - http01:
          ingress:
            class: traefik
```

### 2.3 Container Registry Credentials (GHCR)
Create pull secrets for private container images in both namespaces:
```bash
kubectl create namespace conduit-system
kubectl create namespace store-default

kubectl create secret docker-registry ghcr-secret \
  --namespace conduit-system \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_PAT

kubectl create secret docker-registry ghcr-secret \
  --namespace store-default \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_PAT
```

---

## 3. Production Secrets Provisioning

Secrets must use the exact same key names as local development, managed via **SOPS + age** or secure generation.

### 3.1 Provisioning `conduit-secrets`
```bash
kubectl create secret generic conduit-secrets \
  --namespace conduit-system \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=API_KEY_PEPPER="$(openssl rand -base64 32)" \
  --from-literal=CREDENTIAL_ENC_KEYS="k1:$(openssl rand -base64 32)" \
  --from-literal=BOOTSTRAP_ADMIN_PASSWORD="$(openssl rand -base64 16)" \
  --from-literal=GEMINI_API_KEY="AIzaSy..." \
  --from-literal=MONGO_ROOT_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=MONGO_APP_PASSWORD="$(openssl rand -hex 24)"
```

### 3.2 Provisioning `store-secrets`
```bash
kubectl create secret generic store-secrets \
  --namespace store-default \
  --from-literal=WORDPRESS_DB_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=WORDPRESS_ADMIN_PASSWORD="$(openssl rand -base64 16)" \
  --from-literal=WOO_CONSUMER_KEY="ck_$(openssl rand -hex 20)" \
  --from-literal=WOO_CONSUMER_SECRET="cs_$(openssl rand -hex 20)" \
  --from-literal=MARIADB_ROOT_PASSWORD="$(openssl rand -hex 24)"
```

---

## 4. Local vs. Production Values Comparison

| Configuration Key | Local Development (`values.yaml`) | Production (`values-prod.yaml`) | Architectural Rationale |
|---|---|---|---|
| `global.domain` | `localhost` | `yourdomain.com` | Public TLS-terminated FQDNs. |
| `global.tls.enabled` | `false` | `true` | Enforces HTTPS on all public ingress routes. |
| `global.tls.certIssuer` | `none` | `letsencrypt-prod` | Automated ACME certificate issuance. |
| `global.replicas.gateway` | `1` | `2` | High availability & zero-downtime rolling deploys. |
| `global.replicas.dashboard` | `1` | `2` | Redundant UI serving. |
| `chat.llm` | `fake` (CI/dev) | `gemini` | Refuses to boot with fake LLM in `NODE_ENV=production`. |
| `chat.confirmDestructive` | `false` | `true` | Interactive user confirmation gate on destructive tools. |
| `policy.defaultRoleRule` | `allow` | `members-read-only` | Principle of least privilege for non-admin members. |
| `storage.storageClass` | `local-path` | `local-path` (or CSI provider) | High IOPS NVMe persistent storage. |
| `storage.size.mongo` | `5Gi` | `20Gi` | Scaled for 1-year audit log retention. |
| `security.podSecurityStandard`| `baseline` | `restricted` (conduit-system) | Non-root, read-only root filesystems, drop capabilities. |
| `security.ssrf.allowlist` | `*.svc.cluster.local` | Strict FQDNs | Restricts gateway outbound dials exclusively to internal services. |

---

## 5. Deployment & Rollout

Deploy using Helm with the `--atomic` and `--timeout` flags:

```bash
helm upgrade --install conduit charts/conduit \
  --namespace conduit-system \
  --values charts/conduit/values.yaml \
  --values charts/conduit/values-prod.yaml \
  --set global.domain=yourdomain.com \
  --atomic \
  --timeout 300s

helm upgrade --install store charts/woocommerce-store \
  --namespace store-default \
  --values charts/woocommerce-store/values.yaml \
  --values charts/woocommerce-store/values-prod.yaml \
  --set global.domain=yourdomain.com \
  --atomic \
  --timeout 300s
```

---

## 6. Real Upgrade and Rollback Drill

### 6.1 Simulated Broken Upgrade Drill
Deploy an intentionally faulty container tag to prove `--atomic` rollback:
```bash
helm upgrade conduit charts/conduit \
  --namespace conduit-system \
  --values charts/conduit/values.yaml \
  --values charts/conduit/values-prod.yaml \
  --set gateway.image.tag=does-not-exist \
  --atomic \
  --timeout 60s
```
**Observed Behavior**:
Kubernetes detects `ImagePullBackOff`. The timeout expires, Helm automatically initiates rollback, and restores the previously healthy revision without downtime.

### 6.2 Manual Rollback
```bash
# Check revision history
helm history conduit -n conduit-system

# Rollback to revision 1
helm rollback conduit 1 -n conduit-system
```

---

## 7. First-Boot Checklist & Verification

1. **Verify Pod Readiness**:
   ```bash
   kubectl get pods -n conduit-system
   kubectl get pods -n store-default
   ```
2. **Retrieve Bootstrap Admin Password**:
   ```bash
   kubectl get secret conduit-secrets -n conduit-system -o jsonpath="{.data.BOOTSTRAP_ADMIN_PASSWORD}" | base64 -d | cut -c1-4 && echo "***"
   ```
3. **First Login & Mandatory Password Change**:
   - Navigate to `https://conduit.yourdomain.com`.
   - Log in with `admin@conduit.localhost` and the retrieved password.
   - You will be immediately redirected to the mandatory `/change-password` screen.
   - Enter a new secure password (>= 12 characters).
4. **Register Upstream Services**:
   - Verify `notes-mcp`, `utils-mcp`, and `woo-mcp` display green `healthy` status.
5. **Execute E2E Smoke Test**:
   ```bash
   make e2e-dod
   ```
