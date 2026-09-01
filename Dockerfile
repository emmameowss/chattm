FROM node:22-slim

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy frontend files first
COPY app/ ./app/

# Copy server files and install dependencies
COPY server/ ./server/
WORKDIR /app/server
RUN npm install --production

EXPOSE 3000

CMD ["npm", "run", "start"]