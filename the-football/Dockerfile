FROM node:20-slim

# Install dependencies for sharp (native image processing)
RUN apt-get update && apt-get install -y \
    libvips-dev \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application source
COPY . .

# Create data directory (will be overridden by volume mount)
RUN mkdir -p /data/uploads/originals /data/uploads/thumbnails

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

CMD ["node", "server.js"]
