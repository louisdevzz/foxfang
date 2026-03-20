FROM node:22-bookworm AS build

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json foxfang.cjs ./
COPY src ./src
COPY scripts ./scripts
COPY skills ./skills
COPY AGENTS.md CLAUDE.md README.md SOUL.md ./

RUN pnpm install --frozen-lockfile
RUN pnpm run build
RUN pnpm prune --prod

FROM node:22-bookworm AS runtime

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/foxfang.cjs ./foxfang.cjs
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/skills ./skills
COPY --from=build /app/AGENTS.md ./AGENTS.md
COPY --from=build /app/CLAUDE.md ./CLAUDE.md
COPY --from=build /app/README.md ./README.md
COPY --from=build /app/SOUL.md ./SOUL.md
COPY scripts/start-railway.sh ./scripts/start-railway.sh

RUN chmod +x ./scripts/start-railway.sh

EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["bash", "scripts/start-railway.sh"]
