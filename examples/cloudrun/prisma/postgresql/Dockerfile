# Use a Node.js image to build the application
FROM node:25 as builder

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
COPY package*.json ./
COPY tsconfig.json ./
COPY schema.prisma ./

# Debian Bullseye/Bookworm's OpenSSL is version 3. Prisma currently requires version 1.1.
# See https://github.com/prisma/prisma/issues/17335
RUN apt-get update && apt-get install -y wget && \
    wget http://deb.debian.org/debian/pool/main/o/openssl/libssl1.1_1.1.1w-0+deb11u1_amd64.deb && \
    dpkg -i libssl1.1_1.1.1w-0+deb11u1_amd64.deb && \
    rm libssl1.1_1.1.1w-0+deb11u1_amd64.deb

# Install dependencies and build the application
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

# Use a slim Node.js image for the production environment
FROM node:20-slim

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy package.json to the container image.
COPY package*.json ./
COPY schema.prisma ./

# Debian Bullseye/Bookworm's OpenSSL is version 3. Prisma currently requires version 1.1.
# See https://github.com/prisma/prisma/issues/17335
RUN apt-get update && apt-get install -y wget && \
    wget http://deb.debian.org/debian/pool/main/o/openssl/libssl1.1_1.1.1w-0+deb11u1_amd64.deb && \
    dpkg -i libssl1.1_1.1.1w-0+deb11u1_amd64.deb && \
    rm libssl1.1_1.1.1w-0+deb11u1_amd64.deb

# Install production dependencies.
RUN npm install --omit=dev

# Copy the built application from the builder stage.
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules/.prisma ./.prisma

# Run the web service on container startup.
CMD ["node", "dist/index.js"]
