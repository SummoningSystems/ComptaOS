FROM node:20.19.5-alpine AS build

WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY backend/src/domain/ /workspace/backend/src/domain/
RUN BASE_PATH=/comptaos-preprod/ npm run build

FROM nginx:1.27-alpine
COPY deployment/preproduction-web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist /usr/share/nginx/html
