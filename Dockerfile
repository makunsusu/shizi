FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8765
ENV DATA_DIR=/app/runtime/data
ENV CONFIG_DIR=/app/runtime/config

COPY package.json ./
COPY app.js ./
COPY server.js ./
COPY index.html ./
COPY styles.css ./
COPY scripts ./scripts
COPY skills ./skills
COPY config ./config
COPY data ./data

EXPOSE 8765

CMD ["npm", "start"]
