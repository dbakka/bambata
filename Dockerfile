FROM node:20-slim

WORKDIR /app

# Build tools required by better-sqlite3 (native addon)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build (Vite frontend + tsc server)
COPY . .
RUN npm run build

ENV NODE_ENV=production

CMD ["npm", "start"]
