FROM ai-manju-local/node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

# Pre-built on host: pnpm --filter ai-manhua-studio build
COPY ai-manhua-studio/dist ./dist

EXPOSE 3100
CMD ["node", "dist/index.js"]
