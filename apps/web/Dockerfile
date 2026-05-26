# Next.js standalone build. Build context = repo root.
#   docker build -f apps/web/Dockerfile -t hotbox-web .

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile
# Next.js with `output: 'standalone'` evaluates next.config.ts's rewrites() at
# build time and bakes the result into the standalone server's manifest. So
# HOTBOX_API_URL has to be set HERE, not just at runtime, for the /api/* proxy
# to point at the api container instead of falling back to 127.0.0.1.
ARG HOTBOX_API_URL=http://hotbox-api:3000
ENV HOTBOX_API_URL=$HOTBOX_API_URL
RUN pnpm -F @hotbox/web build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Standalone output puts a self-contained server.js in this directory.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
