FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Đảm bảo thư mục upload tồn tại
RUN mkdir -p public/uploads data

EXPOSE 3000

CMD ["node", "server.js"]
