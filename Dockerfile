# Multi-stage lightweight Dockerfile for Parkistics
FROM node:20-alpine AS runner

WORKDIR /app

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy application files
COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

EXPOSE 4000

CMD ["node", "backend/src/index.js"]
