# Firmo en une image (décision 0005) : web TanStack Start sur :3000 (seul port exposé), qui relaie
# /v1 et /health vers l'API Hono + worker sur :8790 dans le même conteneur.
# Les migrations ne tournent pas au démarrage : elles sont appliquées par firmo-db (OPERATIONS.md).

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci

COPY api api
COPY web web
RUN cd api && npm run build && npm prune --omit=dev

# Variables du site lues à la construction (adresses publiques des canaux).
ARG VITE_WHATSAPP_NUMBER=""
ARG VITE_TELEGRAM_BOT=""
ENV VITE_WHATSAPP_NUMBER=$VITE_WHATSAPP_NUMBER VITE_TELEGRAM_BOT=$VITE_TELEGRAM_BOT
RUN cd web && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
# curl : contrôle de santé de Coolify.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000 FIRMO_API_PORT=8790 FIRMO_API_INTERNAL_URL=http://127.0.0.1:8790

COPY --from=build /app/api/package.json api/
COPY --from=build /app/api/node_modules api/node_modules
COPY --from=build /app/api/dist api/dist
COPY --from=build /app/api/templates api/templates
COPY --from=build /app/web/package.json web/
COPY --from=build /app/web/node_modules web/node_modules
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/web/scripts/serve.mjs web/scripts/serve.mjs
COPY deploy deploy

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "deploy/start.mjs"]
