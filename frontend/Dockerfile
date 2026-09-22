# Dev-mode image — source is bind-mounted at runtime (see
# infra/docker-compose.yml) for Vite's HMR. node_modules is a separate
# named volume, same reasoning as app-api/Dockerfile.
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 5173
