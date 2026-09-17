FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/shopping.sqlite
EXPOSE 3000
CMD ["node", "server.mjs"]
