FROM node:20-alpine

WORKDIR /app

# Cài đặt tzdata và thiết lập múi giờ Việt Nam (GMT+7)
RUN apk add --no-cache tzdata
ENV TZ=Asia/Ho_Chi_Minh

# Thiết lập môi trường sản xuất
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --only=production || npm install --production

COPY . .

# Đảm bảo các thư mục upload và data tồn tại
RUN mkdir -p public/uploads data

EXPOSE 8080

CMD ["node", "server.js"]

