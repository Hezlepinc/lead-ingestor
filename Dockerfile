# ---- Playwright base image (Chromium preinstalled) ----
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Copy everything else
COPY . .

# Default command (your refresh script)
CMD ["node", "scripts/refresh-tokens.js"]


