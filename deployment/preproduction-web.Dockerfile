FROM node:20.19.5-alpine AS build

WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN BASE_PATH=/comptaos-preprod/ npm run build

FROM nginx:1.27-alpine
COPY deployment/preproduction-web.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
