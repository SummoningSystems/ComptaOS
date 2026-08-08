FROM node:20.19.5-alpine

RUN apk add --no-cache git ca-certificates

WORKDIR /app
CMD ["node", "dist/index.js"]
