FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
ENV DATABASE_URL="postgresql://sme_hotel:sme_hotel_dev@postgres:5432/sme_hotel?schema=public"
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache sqlite
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
COPY docker-entrypoint-worker.sh ./docker-entrypoint-worker.sh
COPY docker-entrypoint-migrate.sh ./docker-entrypoint-migrate.sh
RUN chmod +x ./docker-entrypoint.sh ./docker-entrypoint-worker.sh ./docker-entrypoint-migrate.sh ./scripts/wait-for-postgres.sh

EXPOSE 4000
ENTRYPOINT ["./docker-entrypoint.sh"]

