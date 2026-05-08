FROM node:24-alpine@sha256:8e2c930fda481a6ec141fe5a88e8c249c69f8102fe98af505f38c081649ea749

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig*.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapters/package.json ./packages/adapters/
COPY packages/grpc/package.json ./packages/grpc/
COPY packages/registry/package.json ./packages/registry/
COPY cli/package.json ./cli/
COPY apps/demo/package.json ./apps/demo/

RUN pnpm install --frozen-lockfile --filter a2a-demo...

COPY . .
RUN pnpm --filter a2a-demo... --if-present run build

WORKDIR /app/apps/demo
USER node
CMD ["node", "--import", "tsx", "main.ts"]
