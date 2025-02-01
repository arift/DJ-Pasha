FROM node:23-slim
COPY . /app
WORKDIR /app
RUN npm ci
RUN npm run build
ENTRYPOINT ["node", "build/index.js"]
