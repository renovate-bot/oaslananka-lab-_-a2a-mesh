FROM node:24-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749 AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable

FROM base AS builder
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile --filter a2a-mesh...

COPY . .
RUN pnpm --filter a2a-mesh run build
RUN pnpm --filter a2a-mesh --prod deploy /app/deploy

FROM node:24-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749 AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 10001 -S a2a && adduser -S -D -H -u 10001 -G a2a a2a
COPY --from=builder --chown=a2a:a2a /app/deploy ./

EXPOSE 3000
USER a2a
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.cjs"]
