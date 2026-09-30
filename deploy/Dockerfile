# Counterwell server: the API and the extraction worker run from this one image.
FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g tsx@4
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm install --omit=dev --no-audit --no-fund --ignore-scripts \
      -w @counterwell/api -w @counterwell/core -w @counterwell/db
COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/api apps/api
COPY scripts/seed.ts scripts/create-shop.ts scripts/check-shop.ts scripts/
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
CMD ["tsx", "apps/api/src/index.ts"]
