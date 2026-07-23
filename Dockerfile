FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ffmpeg mediainfo tini jq python3 file \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 harness \
  && useradd --uid 10001 --gid harness --create-home --home-dir /home/harness --shell /usr/sbin/nologin harness

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /data/workspaces /data/artifacts \
  && chown -R harness:harness /data /home/harness

ENV NODE_ENV=production \
  VIDEO_HARNESS_HOST=0.0.0.0 \
  VIDEO_HARNESS_PORT=3210 \
  VIDEO_HARNESS_DATA_DIR=/data

USER harness
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/api/index.js"]
