# ── Base image ───────────────────────────────────────────────────────
FROM node:18-alpine

# Set working directory inside container
WORKDIR /app

# ── Install dependencies first (layer caching) ───────────────────────
# Copy only package files first — so npm install layer is cached
# unless package.json changes
COPY package*.json ./

RUN npm install --omit=dev

# ── Copy source code ─────────────────────────────────────────────────
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose API port
EXPOSE 3000
