# ---- Build ----
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./
COPY packages/shared/ packages/shared/
COPY packages/pwa/ packages/pwa/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @safecare/shared build 2>/dev/null || true
RUN pnpm --filter @safecare/pwa build

# ---- Serve with lightweight static server ----
FROM node:20-alpine AS production
RUN npm install -g serve

COPY --from=build /app/packages/pwa/dist /app/dist

ENV PORT=5173
EXPOSE 5173

CMD ["serve", "-s", "/app/dist", "-l", "5173"]
