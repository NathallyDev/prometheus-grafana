FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install --production

# Bundle app source
COPY . .

EXPOSE 3100
CMD ["node","server.js"]
