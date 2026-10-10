# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root manifests and lockfiles
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/woo-mcp/package.json apps/woo-mcp/tsconfig.json ./apps/woo-mcp/
COPY apps/woo-mcp/src ./apps/woo-mcp/src

# Install all dependencies and build packages
RUN npm ci
RUN npm run build --workspaces

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100
ENV HOST=0.0.0.0

# Create dedicated non-root user and group
RUN addgroup -g 10001 -S conduit && \
    adduser -u 10001 -S -G conduit -s /sbin/nologin conduit

# Copy package manifests for workspace resolution
COPY --from=builder --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=10001:10001 /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /app/apps/woo-mcp/package.json ./apps/woo-mcp/

# Install production dependencies only
RUN npm ci --omit=dev --workspace=@conduit/woo-mcp --workspace=@conduit/shared && \
    npm cache clean --force

# Copy compiled code from builder
COPY --from=builder --chown=10001:10001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /app/apps/woo-mcp/dist ./apps/woo-mcp/dist

USER 10001:10001

EXPOSE 3100

CMD ["node", "apps/woo-mcp/dist/index.js"]
