# Build context is the REPO ROOT (npm workspaces monorepo), not this
# directory — build with:
#   docker build -f packages/web/Dockerfile -t <image> .
# (the GitHub Actions workflow at .github/workflows/ci.yml does this.)

FROM node:24-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY packages/web packages/web
RUN npm run build --workspace=packages/web

# nginx serves the built static assets and reverse-proxies API/Socket.io
# calls to the backend (see docker/nginx.conf.template) — the SPA itself
# only ever makes same-origin requests (lib/api.ts/lib/socket.ts), so a
# plain static file server alone wouldn't be functional standalone.
FROM nginx:1.27-alpine
COPY --from=build /repo/packages/web/dist /usr/share/nginx/html
COPY packages/web/docker/nginx.conf.template /etc/nginx/templates/default.conf.template

# Overridable at `docker run -e BACKEND_HOST=... -e BACKEND_PORT=...` —
# defaults assume the backend container is reachable as `server` on the
# same Docker network (e.g. a docker-compose service named "server").
ENV BACKEND_HOST=server
ENV BACKEND_PORT=3001

EXPOSE 80
