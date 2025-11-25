# Use the official Node.js image.
# https://hub.docker.com/_/node
FROM node:25-slim

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
# A wildcard is used to ensure both package.json AND package-lock.json are copied.
# Copying this separately prevents re-running npm install on every code change.
COPY package*.json ./
COPY schema.prisma ./

# Debian Bullseye/Bookworm's OpenSSL is version 3. Prisma currently requires version 1.1.
# See https://github.com/prisma/prisma/issues/17335
RUN apt-get update && apt-get install -y wget && \
    wget http://deb.debian.org/debian/pool/main/o/openssl/libssl1.1_1.1.1w-0+deb11u1_amd64.deb && \
    dpkg -i libssl1.1_1.1.1w-0+deb11u1_amd64.deb && \
    rm libssl1.1_1.1.1w-0+deb11u1_amd64.deb

# Install production dependencies.
# If you add a package-lock.json speed your build by switching to 'npm ci'.
# RUN npm ci --only=production
RUN npm install --omit=dev

# Generate Prisma Client
RUN npx prisma generate

# Copy local code to the container image.
COPY . .

# Run the web service on container startup.
CMD ["node", "index.mjs"]
