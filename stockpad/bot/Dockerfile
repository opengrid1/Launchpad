FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.mjs keeper.mjs ./
VOLUME ["/data"]
ENV STATE_FILE=/data/state.json
CMD ["node", "index.mjs"]
