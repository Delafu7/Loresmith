# Build context is the REPO ROOT (npm workspaces monorepo), not this
# directory — build with:
#   docker build -f packages/server/Dockerfile -t <image> .
# (the GitHub Actions workflow at .github/workflows/ci.yml does this.)

FROM node:24-alpine AS build
WORKDIR /repo

# Only the manifests needed to resolve the workspace tree, so this layer
# stays cached across source-only changes. `npm ci` at the root installs
# every workspace's deps (same as local dev / `npm test` in CI) — both
# package.json files must be present or npm's workspace resolution fails.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY packages/server packages/server
RUN npm run build --workspace=packages/server

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /repo/packages/server

# node_modules is hoisted to the workspace root by npm — copying just that
# (not a per-package node_modules, which mostly won't exist) is enough:
# Node's module resolution walks up parent directories from dist/index.js.
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages/server/package.json ./package.json
COPY --from=build /repo/packages/server/dist ./dist
COPY --from=build /repo/packages/server/.node-pg-migraterc.json ./.node-pg-migraterc.json
# The seed script runs on the TS source directly via tsx (not dist/), and
# reaches beyond src/db into shared modules like middleware/upload.ts — the
# full src/ tree is simplest and safest rather than chasing its import graph.
COPY --from=build /repo/packages/server/src ./src
# db/seeds/catalog.ts resolves SRD reference data relative to the REPO ROOT
# (5 levels up from src/db/seeds), not this package — an absolute repo-root
# path here, not a package-relative one, matching that.
COPY .opencode/skills/dnd5e-srd/data /repo/.opencode/skills/dnd5e-srd/data

# Config (DATABASE_URL, REDIS_URL, SESSION_SECRET, CLIENT_ORIGIN, PORT,
# MAX_UPLOAD_BYTES — see .env.example) is supplied at `docker run` time via
# real environment variables, never baked into the image.
#
# Migrations/seeding are NOT run automatically on container start (this repo
# has no such convention even in dev — see README) — run them explicitly
# against this image before starting it, e.g.:
#   docker run --rm -e DATABASE_URL=... <image> npm run migrate
EXPOSE 3001
CMD ["node", "dist/index.js"]
