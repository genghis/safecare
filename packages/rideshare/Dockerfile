FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# --- Dependencies ---
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/rideshare/package.json ./packages/rideshare/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/rideshare/node_modules ./packages/rideshare/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY packages/shared ./packages/shared
COPY packages/rideshare ./packages/rideshare
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
# Build shared package first (rideshare imports from it)
RUN cd packages/shared && npx tsc -p tsconfig.json --skipLibCheck
WORKDIR /app/packages/rideshare
RUN pnpm build

# --- Production ---
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=build --chown=nextjs:nodejs /app/packages/rideshare/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/packages/rideshare/.next/static ./packages/rideshare/.next/static
COPY --from=build --chown=nextjs:nodejs /app/packages/rideshare/public ./packages/rideshare/public

USER nextjs

EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/rideshare/server.js"]
