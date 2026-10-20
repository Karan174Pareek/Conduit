# Stage 1: Build
FROM node:26-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src ./packages/shared/src
COPY apps/notes-mcp/package.json apps/notes-mcp/tsconfig.json ./apps/notes-mcp/
COPY apps/notes-mcp/src ./apps/notes-mcp/src

RUN npm ci
RUN npm run build --workspace=@conduit/shared
RUN npm run build --workspace=@conduit/notes-mcp

# Stage 2: Production runtime
FROM node:26-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3200
ENV HOST=0.0.0.0
ENV NOTES_FILE_PATH=/data/notes.json

RUN addgroup -g 10001 -S conduit && \
    adduser -u 10001 -S -G conduit -s /sbin/nologin conduit && \
    mkdir -p /data && chown -R 10001:10001 /data

COPY --from=builder --chown=10001:10001 /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=10001:10001 /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=10001:10001 /app/apps/notes-mcp/package.json ./apps/notes-mcp/

RUN npm ci --omit=dev --workspace=@conduit/notes-mcp --workspace=@conduit/shared && \
    npm cache clean --force && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn*

COPY --from=builder --chown=10001:10001 /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=10001:10001 /app/apps/notes-mcp/dist ./apps/notes-mcp/dist

VOLUME ["/data"]

USER 10001:10001

EXPOSE 3200

CMD ["node", "apps/notes-mcp/dist/index.js"]
