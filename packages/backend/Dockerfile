# ---- Stage 1: Build ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./

# Copy shared package
COPY packages/shared/ packages/shared/

# Copy backend package
COPY packages/backend/ packages/backend/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared first, then backend
RUN pnpm --filter @safecare/shared build 2>/dev/null || true
RUN pnpm --filter @safecare/backend build

# ---- Stage 2: Production ----
FROM --platform=$BUILDPLATFORM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy shared package (built)
COPY --from=builder /app/packages/shared/ packages/shared/

# Copy backend build output and package.json
COPY --from=builder /app/packages/backend/dist/ packages/backend/dist/
COPY --from=builder /app/packages/backend/package.json packages/backend/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Set environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

WORKDIR /app/packages/backend

CMD ["node", "dist/index.js"]
