# Build the React application first; the Go server serves web/dist in production.
# web-build uses a glibc base (not alpine): the lockfile is generated on glibc and
# npm ci omits the lightningcss musl native binary, breaking the vite build. The
# dist output is static files, so the final alpine runtime is unaffected.
FROM node:22-bookworm-slim AS web-build
WORKDIR /src/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
ARG VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
RUN npm run build

FROM golang:1.27-alpine AS server-build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /streammock ./cmd/server

FROM alpine:3.22 AS packager-download
ARG TARGETARCH
ARG SHAKA_PACKAGER_VERSION=v3.9.3
RUN apk add --no-cache ca-certificates wget \
    && case "$TARGETARCH" in \
         amd64) asset=x64; checksum=7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6 ;; \
         arm64) asset=arm64; checksum=d3a50cecc139b54435be1bbbfba5c0ea822d9e1e7edc3531f7821fba65ceebb0 ;; \
         *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
       esac \
    && wget -q -O /packager "https://github.com/shaka-project/shaka-packager/releases/download/${SHAKA_PACKAGER_VERSION}/packager-linux-${asset}" \
    && echo "${checksum}  /packager" | sha256sum -c - \
    && chmod 0755 /packager

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S streammock \
    && adduser -S -G streammock streammock \
    && mkdir -p /data \
    && chown streammock:streammock /data

WORKDIR /app
COPY --from=server-build /streammock ./streammock
COPY --from=web-build /src/web/dist ./web/dist
COPY --from=packager-download /packager /usr/local/bin/packager

USER streammock
ENV STREAMMOCK_ADDR=:8080 \
    STREAMMOCK_DB=/data/streammock.db \
    STREAMMOCK_STORAGE=/data/streammock-data
EXPOSE 8080

CMD ["./streammock"]
