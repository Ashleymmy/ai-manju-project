FROM node:22-alpine AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/studio/package.json apps/studio/package.json
COPY apps/director-desk/package.json apps/director-desk/package.json
COPY packages/canvas-agent-protocol/package.json packages/canvas-agent-protocol/package.json

COPY apps/studio ./apps/studio
COPY apps/director-desk ./apps/director-desk
COPY packages/canvas-agent-protocol ./packages/canvas-agent-protocol
RUN pnpm install --frozen-lockfile --filter ai-manhua-studio... --filter @ai-manju/director-desk... --filter @ai-manju/canvas-agent-protocol...

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter ai-manhua-studio build

FROM nginx:1.27-alpine

COPY apps/studio/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/studio/dist/public /usr/share/nginx/html

EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=5s --retries=20 CMD wget -qO- http://127.0.0.1:3100/ >/dev/null || exit 1
