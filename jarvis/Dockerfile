# JARVIS — single-process image (API + dashboard + scheduler)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 JARVIS_DATA_DIR=/app/.data
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server ./server
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 8787
CMD ["node", "--experimental-strip-types", "server/index.ts"]
