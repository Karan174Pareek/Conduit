# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/demo-notes-mcp/package.json apps/demo-notes-mcp/tsconfig.json ./apps/demo-notes-mcp/
COPY apps/demo-notes-mcp/src ./apps/demo-notes-mcp/src

RUN npm ci
RUN npm run build --workspace=@conduit/shared
RUN npm run build --workspace=@conduit/demo-notes-mcp

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3200
ENV HOST=0.0.0.0

RUN addgroup -g 10001 -S conduit && \
    adduser -u 10001 -S -G conduit -s /sbin/nologin conduit

COPY --from=builder --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=10001:10001 /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /app/apps/demo-notes-mcp/package.json ./apps/demo-notes-mcp/

RUN npm ci --omit=dev --workspace=@conduit/demo-notes-mcp --workspace=@conduit/shared && \
    npm cache clean --force

COPY --from=builder --chown=10001:10001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /app/apps/demo-notes-mcp/dist ./apps/demo-notes-mcp/dist

USER 10001:10001

EXPOSE 3200

CMD ["node", "apps/demo-notes-mcp/dist/index.js"]
