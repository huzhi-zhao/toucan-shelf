FROM node:22-alpine AS frontend
WORKDIR /frontend-build

RUN corepack enable && corepack prepare pnpm@11.0.1 --activate

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY web/ ./
RUN pnpm vite build --mode release --outDir=./dist --emptyOutDir

FROM --platform=$BUILDPLATFORM golang:1.26.2-alpine AS backend
WORKDIR /backend-build

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .
COPY --from=frontend /frontend-build/dist ./server/router/frontend/dist

ARG TARGETOS TARGETARCH VERSION=dev COMMIT=unknown
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build \
      -trimpath \
      -ldflags="-s -w -X github.com/usememos/memos/internal/version.Version=${VERSION} -X github.com/usememos/memos/internal/version.Commit=${COMMIT} -extldflags '-static'" \
      -tags netgo,osusergo \
      -o memos \
      ./cmd/memos

# The memogit build that matches this server, published under /memogit/ for
# downstream repos (server/router/memogitdist). Built here rather than on the
# host so deploying needs nothing but Docker. The build context has no .git, so
# the version (commit date + hash, what `memogit -v` prints) comes in as a
# build arg: deploy.sh computes it from the checkout it deploys.
FROM --platform=$BUILDPLATFORM golang:1.26.2-alpine AS memogit
WORKDIR /memogit-build

RUN apk add --no-cache bash

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

ARG MEMOGIT_VERSION
# Publishing an "unknown" version would be worse than failing: install.sh only
# compares versions for equality, so every downstream would read "unknown" as
# up to date and never update again.
RUN test -n "$MEMOGIT_VERSION" || { \
      echo "MEMOGIT_VERSION is required: deploy with ./deploy.sh, or pass" >&2; \
      echo "  --build-arg MEMOGIT_VERSION=\$(TZ=UTC git log -1 --date=format-local:%Y.%m.%d --format=%cd)-\$(git rev-parse --short=9 HEAD)" >&2; \
      exit 1; }
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    MEMOGIT_VERSION="$MEMOGIT_VERSION" ./scripts/build-memogit.sh --dist

FROM alpine:3.21

RUN apk add --no-cache tzdata ca-certificates su-exec && \
    addgroup -g 10001 -S nonroot && \
    adduser -u 10001 -S -G nonroot -h /var/opt/memos nonroot && \
    mkdir -p /var/opt/memos /usr/local/memos && \
    chown -R nonroot:nonroot /var/opt/memos

COPY --from=backend /backend-build/memos /usr/local/memos/memos
COPY --from=backend --chmod=755 /backend-build/scripts/entrypoint.sh /usr/local/memos/entrypoint.sh
COPY --from=memogit /memogit-build/memogit-dist /usr/local/memos/memogit-dist

USER root

WORKDIR /var/opt/memos

VOLUME /var/opt/memos

ENV TZ="UTC" \
    MEMOS_PORT="5230" \
    MEMOS_MEMOGIT_DIST="/usr/local/memos/memogit-dist"

EXPOSE 5230

ENTRYPOINT ["/usr/local/memos/entrypoint.sh", "/usr/local/memos/memos"]
