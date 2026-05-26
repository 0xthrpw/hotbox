# Build & run the hotbox API. Build context = repo root.
#   docker build -f apps/api/Dockerfile -t hotbox-api .

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/reconciler apps/reconciler
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "-F", "@hotbox/api", "start"]
