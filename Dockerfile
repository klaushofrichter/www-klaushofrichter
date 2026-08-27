FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY CHANGELOG.md ./
COPY assets ./assets
RUN mkdir -p /app/data/images && chown -R node:node /app/data
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
