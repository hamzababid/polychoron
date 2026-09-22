# Dev-mode image — source is bind-mounted at runtime (see
# infra/docker-compose.yml) for hot reload via `nest start --watch`.
# node_modules is a separate named volume in compose, not part of the
# bind mount — this image's own Linux-native node_modules (installed
# here at build time) must not be shadowed by a host node_modules
# built for a different OS/architecture.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000
