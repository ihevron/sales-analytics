FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

COPY package.json ./
RUN npm install --omit=dev
COPY index.html app.js styles.css server.js README.md ./
COPY management ./management
COPY management-postgres ./management-postgres

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4173
CMD ["node", "server.js"]
