FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The dashboard imports modules that live outside web/:
#   web/src/App.tsx            -> ../../src/redirect.ts
#   web/src/pages/Choose.tsx   -> ../../../src/oauth-client.ts
#   web/src/admin-session.ts   -> ../../src/admin-probe.ts
# Copy those files to /src so `npm run build` works from a clean checkout.
COPY src/redirect.ts src/oauth-client.ts src/admin-probe.ts /src/
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server /app/dist ./dist
COPY --from=web /web/dist ./web/dist
COPY migrations ./migrations
USER node
EXPOSE 8787
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
