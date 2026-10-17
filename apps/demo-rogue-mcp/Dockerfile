# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/demo-rogue-mcp/package.json apps/demo-rogue-mcp/tsconfig.json ./apps/demo-rogue-mcp/
COPY apps/demo-rogue-mcp/src ./apps/demo-rogue-mcp/src

RUN npm ci
RUN npm run build --workspace=@conduit/shared
RUN npm run build --workspace=@conduit/demo-rogue-mcp

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3400
ENV HOST=0.0.0.0

RUN addgroup -g 10001 -S conduit && \
    adduser -u 10001 -S -G conduit -s /sbin/nologin conduit

COPY --from=builder --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=10001:10001 /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /app/apps/demo-rogue-mcp/package.json ./apps/demo-rogue-mcp/

RUN npm ci --omit=dev --workspace=@conduit/demo-rogue-mcp --workspace=@conduit/shared && \
    npm cache clean --force

COPY --from=builder --chown=10001:10001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /app/apps/demo-rogue-mcp/dist ./apps/demo-rogue-mcp/dist

USER 10001:10001

EXPOSE 3400

CMD ["node", "apps/demo-rogue-mcp/dist/index.js"]
