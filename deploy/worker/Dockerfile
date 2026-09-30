FROM node:22-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.worker.json ./
RUN npm ci
COPY apps ./apps
COPY packages ./packages
RUN npm run worker:build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist-worker ./dist-worker
COPY package.json ./

EXPOSE 8787

CMD ["node", "dist-worker/apps/worker/src/server.js"]
