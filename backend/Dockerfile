FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# Create package.json if not exists (simple version for this demo)
RUN if [ ! -f package.json ]; then \
    echo '{"name":"logiglobe-backend","version":"1.0.0","main":"server.js","dependencies":{"express":"^4.18.2","cors":"^2.8.5"}}' > package.json; \
    fi

RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
