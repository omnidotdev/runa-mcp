# syntax=docker/dockerfile:1

FROM oven/bun:1.4.4 AS base
WORKDIR /app

# Install runtime dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Run the hosted Streamable HTTP server directly from source
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

USER bun
EXPOSE 3000
CMD ["bun", "run", "src/http.ts"]
