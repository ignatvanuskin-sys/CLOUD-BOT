FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-distutils \
    python3-venv \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "run", "server"]
