# Stage 1: Build dashboard bundle
FROM node:22-alpine AS builder

WORKDIR /build

# Copy root monorepo files for dependencies
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/dashboard/package*.json ./apps/dashboard/

RUN npm ci --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY apps/dashboard/ ./apps/dashboard/
COPY tsconfig.base.json ./

RUN npm run build --workspace=@conduit/dashboard

# Stage 2: Runtime unprivileged Nginx
FROM nginxinc/nginx-unprivileged:alpine

USER 101

# Copy custom Nginx configuration with strict CSP
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets
COPY --from=builder /build/apps/dashboard/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
