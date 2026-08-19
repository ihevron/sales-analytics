FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

COPY package.json ./
RUN npm install --omit=dev
COPY index.html app.js styles.css customer.html customer.css customer.js server.js price-audit-core.js price-audit-openapi.json README.md install-health-ministry.js health-ministry-payload-00.txt health-ministry-payload-01.txt health-ministry-payload-02.txt health-ministry-payload-03.txt health-ministry-payload-04.txt health-ministry-payload-05.txt health-ministry-payload-06.txt health-ministry-payload-07.txt health-ministry-payload-08.txt health-ministry-v3-assets-00.txt health-ministry-v3-assets-01.txt health-ministry-v3-assets-02.txt health-ministry-v3-assets-03.txt health-ministry-v3-assets-04.txt health-ministry-v3-assets-05.txt health-ministry-v3-assets-06.txt health-ministry-template-v2-00.txt health-ministry-template-v2-01.txt health-ministry-template-v2-02.txt health-ministry-template-v2-03.txt health-ministry-template-v2-04.txt health-ministry-template-v2-05.txt health-ministry-template-v2-06.txt health-ministry-template-v2-07.txt health-ministry-template-v2-08.txt health-ministry-api.js server-with-health-ministry.js ./
COPY api ./api
COPY management ./management
COPY management-postgres ./management-postgres
RUN node ./install-health-ministry.js && rm ./install-health-ministry.js

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 4173
CMD ["node", "server-with-health-ministry.js"]
