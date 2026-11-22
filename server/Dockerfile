FROM node:22.13-bookworm-slim
WORKDIR /srv/livex
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY web ./web
COPY scripts ./scripts
# keys/, data/ and releases/ are mounted as volumes; secrets come from env or the keys volume.
VOLUME ["/srv/livex/data", "/srv/livex/keys", "/srv/livex/releases"]
EXPOSE 8787
ENV HOST=0.0.0.0
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
