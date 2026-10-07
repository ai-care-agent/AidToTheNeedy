# One container: the Express API serves the built web apps from the same origin (npm start).
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# The demo household lives in SQLite; on a free host the disk is temporary, which suits a demo
# (it is seeded again on start, and every morning with DEMO_RESET_DAILY=1).
ENV PORT=8787 \
    DB_PATH=/app/data/care.db \
    DEMO_RESET_DAILY=1
EXPOSE 8787
CMD ["npm", "start"]
