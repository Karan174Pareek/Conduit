# Development Log — Conduit

## Phase 2 & Security Notes

### TODO: Phase 7 — Evaluate WordPress Non-Root Container Architecture
- **Context**: The current `images/wordpress/Dockerfile` is based on the official `wordpress:6.7.2-apache` image, which starts as `root` (UID 0) to bind port 80 before setuid-ing to `www-data` (UID 33). This requires a documented exception for Trivy misconfiguration rule `DS-0002` in `.trivyignore.yaml` and [docs/SECURITY.md §7](SECURITY.md).
- **Phase 7 Hardening Evaluation**:
  - Investigate running WordPress completely non-root:
    1. Option A: Custom Apache configuration binding port 8080 as `www-data` directly without starting as root.
    2. Option B: `wordpress:fpm` coupled with `nginx-unprivileged` sidecar in the same pod.
  - Test performance, file permissions on `wp-content` PVC mounts, and compatibility with the automated setup hook (`wp core install`).
