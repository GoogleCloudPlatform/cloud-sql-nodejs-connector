# Use a Node.js image to build the application
FROM node:25 AS builder

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies and build the application
RUN npm install
COPY . .
RUN npm run build

# Use a slim Node.js image for the production environment
FROM node:20-slim

# Create and change to the app directory.
WORKDIR /usr/src/app

# Copy package.json to the container image.
COPY package*.json ./

# Install production dependencies.
RUN npm install --omit=dev

# Copy the built application from the builder stage.
COPY --from=builder /usr/src/app/dist ./dist

# Run the web service on container startup.
CMD ["node", "dist/index.js"]