FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

COPY package.json ./
RUN npm install --omit=dev
COPY index.html app.js styles.css customer.html customer.css customer.js server.js price-audit-core.js price-audit-openapi.json README.md install-health-ministry.js ./
COPY api ./api
COPY management ./management
COPY management-postgres ./management-postgres
COPY health-ministry-src ./health-ministry-src
RUN node ./install-health-ministry.js && rm ./install-health-ministry.js && rm -rf ./health-ministry-src

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4173
CMD ["node", "server.js"]
