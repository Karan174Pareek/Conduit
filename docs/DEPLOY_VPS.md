# Deploying Conduit on a Single-Node k3s VPS

This document outlines the deployment strategy for running Conduit on a single-node k3s production environment.

## 1. Architecture Overview
- **Orchestration:** Lightweight Kubernetes (k3s) on Linux (Ubuntu 24.04 LTS recommended).
- **Ingress Controller:** Traefik (built into k3s) handling SSL/TLS termination via cert-manager (Let's Encrypt).
- **Workloads:**
  - conduit-gateway (Fastify MCP Gateway & SSE Chat API)
  - conduit-dashboard (Nginx serving SPA frontend with strict CSP)
  - woo-mcp (WooCommerce Streamable HTTP MCP server)
  - mongodb (StatefulSet with local persistent volume)
  - mariadb (WooCommerce store database)
  - wordpress (WooCommerce application)

---

## 2. Backup Architecture & Limitations

### Single-Node Backup Storage Limitation
In the default local/single-node Helm chart configuration, database backups for MongoDB (conduit-mongodb-backup) and MariaDB (store-woocommerce-store-mariadb-backup) write directly to PersistentVolumeClaims on the local storage provider (local-path).

Because these backup volumes reside physically on the **same underlying host node and disk** as the live database volumes:
1. Host disk failure or filesystem corruption will destroy **both** the primary database and its backups.
2. Node decommissioning or hypervisor disaster results in total data loss.

### Production Requirement: Offsite Backup Replication
For production environments, an **offsite backup copy is strictly mandatory**:
- **Object Storage Synchronization:** Configure an automated post-backup sync step (e.g., rclone or AWS CLI / S3 cron) that immediately pushes /backups/*.dump.gz and /backups/*.sql.gz to an external S3-compatible bucket (AWS S3, Cloudflare R2, or Backblaze B2) with Object Lock / versioning enabled.
- **Snapshot Policy:** Use cloud provider disk snapshots (e.g., Hetzner / AWS EBS daily volume snapshots) stored independent of the VPS instance.
- **Automated Restore Drill:** Periodically execute scripts/backup-restore-drill.sh to verify dump integrity against a secondary verification cluster.

---

## 3. Host Hardening & Prerequisites
- Minimum hardware: 4 vCPU, 8 GB RAM, 50 GB NVMe storage.
- Firewall: UFW restricting all ports except 80, 443, and SSH (on a non-standard port with key-based authentication).
- Kubernetes Secrets Encryption at rest enabled via k3s --secrets-encryption.
