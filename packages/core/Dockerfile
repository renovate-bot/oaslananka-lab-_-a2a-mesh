FROM node:24-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749 AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/
RUN pnpm install --frozen-lockfile --filter a2a-mesh...

COPY . .
RUN pnpm --filter a2a-mesh run build

FROM node:24-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749 AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY --from=builder /app/packages/core/dist ./dist
COPY --from=builder /app/packages/core/package.json ./package.json
COPY --from=builder /app/packages/core/LICENSE ./LICENSE
COPY --from=builder /app/packages/core/README.md ./README.md

RUN pnpm install --prod --ignore-scripts

EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.cjs"]
