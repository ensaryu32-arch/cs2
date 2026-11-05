FROM node:18-alpine

WORKDIR /app

# Cache dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy all game files, assets, parts, and web server
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
