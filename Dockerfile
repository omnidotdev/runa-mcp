# syntax=docker/dockerfile:1

FROM oven/bun:1.4.5@sha256:3aa040e5445efa09d75bb428a64ba50db13e2b3ac9b6b0c7f145615f62b2ee18 AS base
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
