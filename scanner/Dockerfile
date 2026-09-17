FROM node:26-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.scanner.json ./
COPY src/survey ./src/survey
COPY scanner/src ./scanner/src
RUN npm run build:scanner

FROM node:26-alpine
WORKDIR /app
# The whole reason this service exists: arp-scan needs raw sockets, which the
# website's pod deliberately does not have.
RUN apk add --no-cache arp-scan
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist-scanner ./dist-scanner
# Runs as root with every capability dropped except NET_RAW (see the
# Deployment). Root in the container plus one capability is a smaller surface
# than a setcap binary with allowPrivilegeEscalation left on.
EXPOSE 9450
CMD ["node", "dist-scanner/scanner/src/main.js"]
