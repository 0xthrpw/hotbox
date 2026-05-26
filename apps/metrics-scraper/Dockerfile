FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps/metrics-scraper apps/metrics-scraper
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV NODE_ENV=production
COPY --from=build /app /app
CMD ["pnpm", "-F", "@hotbox/metrics-scraper", "start"]
