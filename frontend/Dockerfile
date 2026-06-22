# ──────────────────────────────────────────────────────────────────────────
#  Frontend image — Next.js (App Router). Dev-oriented; for production use a
#  multi-stage build with `next build` + `next start`.
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Hot-reload dev server. Bind to 0.0.0.0 so it's reachable from the host.
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0"]
