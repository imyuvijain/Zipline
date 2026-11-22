# Murmur server for Maritime (server + shared contracts + built web if present).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY web ./web
ENV NODE_ENV=production
# Only /data survives restarts/sleep on Maritime.
ENV DB_PATH=/data/murmur.db
WORKDIR /app/server
CMD ["node", "--import", "tsx", "src/index.ts"]
