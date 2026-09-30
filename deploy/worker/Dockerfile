FROM node:22-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY apps ./apps
COPY packages ./packages
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist
COPY package.json ./

EXPOSE 8787

CMD ["node", "dist/apps/worker/src/server.js"]
