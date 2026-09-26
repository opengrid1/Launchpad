FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY tsconfig.json ./
ENV DATA_DIR=/data
CMD ["npx", "tsx", "src/main.ts"]
