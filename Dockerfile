FROM node:24-bookworm-slim

WORKDIR /app

# Prisma's engine and the production applications require OpenSSL.  Keeping a
# single image for the API, worker, tracker and web ensures they all execute
# the exact same reviewed revision of the workspace.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json ./

# Mercado Livre RPA is deliberately not deployed in the first production
# release. Avoid downloading a browser binary while still installing the
# workspace lockfile consistently.
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NODE_ENV=production

RUN DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public" \
      npx prisma generate --config packages/database/prisma.config.ts \
  && npm run build -w @lia/core \
  && npm run build -w @lia/integrations \
  && npm run build -w api \
  && npm run build -w @lia/worker \
  && npm run build -w @lia/tracker \
  && npm run build -w web
