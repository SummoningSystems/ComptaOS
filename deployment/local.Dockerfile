FROM node:24-alpine AS backend-build
WORKDIR /build/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# Pure financial domain rules are shared with the browser build.
COPY backend/src/domain/ /build/backend/src/domain/
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache git ca-certificates su-exec
WORKDIR /app/backend
COPY --from=backend-build /build/backend/dist ./dist
COPY --from=backend-build /build/backend/node_modules ./node_modules
COPY --from=backend-build /build/backend/package.json ./package.json
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist
COPY deployment/local-entrypoint.sh /usr/local/bin/comptaos-entrypoint
RUN chmod +x /usr/local/bin/comptaos-entrypoint
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 WORKSPACE_PATH=/data/workspace AUTH_ENABLED=true HTTPS_ONLY=true
ENTRYPOINT ["comptaos-entrypoint"]
CMD ["node", "dist/index.js"]
