# One container: the Express API serves the built web apps from the same origin (npm start).
# Our servers run it through deploy/compose.yml; render.yaml runs it as a free public demo.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && mkdir -p data && chown node:node data

# The household lives in SQLite under /app/data: a volume on our servers, a temporary disk on a free
# demo host. A public demo sets DEMO_RESET_DAILY=1 to start with a fresh household every morning.
ENV PORT=8787 \
    DB_PATH=/app/data/care.db
USER node
EXPOSE 8787
CMD ["npm", "start"]
