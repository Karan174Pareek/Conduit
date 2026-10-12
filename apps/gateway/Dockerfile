# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests and configuration
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/gateway/package.json apps/gateway/tsconfig.json ./apps/gateway/
COPY apps/gateway/src ./apps/gateway/src

# Install all dependencies and build TypeScript packages
RUN npm ci
RUN npm run build --workspace=@conduit/shared && npm run build --workspace=@conduit/gateway

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create dedicated non-root user and group (Trivy DS-0002 compliance)
RUN addgroup -g 10001 -S conduit && \
    adduser -u 10001 -S -G conduit -s /sbin/nologin conduit

# Copy package manifests for workspace resolution
COPY --from=builder --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=10001:10001 /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /app/apps/gateway/package.json ./apps/gateway/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=@conduit/gateway --workspace=@conduit/shared && \
    npm cache clean --force

# Copy compiled code from builder
COPY --from=builder --chown=10001:10001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /app/apps/gateway/dist ./apps/gateway/dist

USER 10001:10001

EXPOSE 3000

CMD ["node", "apps/gateway/dist/index.js"]
