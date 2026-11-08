FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production DATA_DIR=/app/data PORT=3000 TRUST_PROXY=1
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 ledger \
  && useradd --system --uid 10001 --gid ledger --home-dir /app --no-create-home ledger
WORKDIR /app
COPY --from=build --chown=ledger:ledger /app/node_modules ./node_modules
COPY --chown=ledger:ledger package.json ./
COPY --chown=ledger:ledger server ./server
COPY --from=build --chown=ledger:ledger /app/dist ./dist
RUN mkdir -p /app/data && chown ledger:ledger /app/data
USER ledger
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
