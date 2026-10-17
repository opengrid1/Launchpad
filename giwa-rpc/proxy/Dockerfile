FROM node:22-slim
WORKDIR /app
COPY server.mjs package.json ./
ENV PORT=8545
EXPOSE 8545
CMD ["node", "server.mjs"]
