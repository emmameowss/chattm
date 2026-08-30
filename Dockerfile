FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY server/package*.json ./
RUN npm install --production

# Copy server code
COPY server/ ./

# Copy frontend files (critical!)
COPY app/ ./app/

EXPOSE 3000

CMD ["npm", "run", "start"]