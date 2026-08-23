# Build the React application first; the Go server serves web/dist in production.
FROM node:22-alpine AS web-build
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

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S streammock \
    && adduser -S -G streammock streammock \
    && mkdir -p /data \
    && chown streammock:streammock /data

WORKDIR /app
COPY --from=server-build /streammock ./streammock
COPY --from=web-build /src/web/dist ./web/dist

USER streammock
ENV STREAMMOCK_ADDR=:8080 \
    STREAMMOCK_DB=/data/streammock.db
EXPOSE 8080

CMD ["./streammock"]
