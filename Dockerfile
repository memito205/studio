# 1. Base Image: Use an official Node.js image.
FROM node:20-alpine AS base

# 2. Set up the working directory
WORKDIR /app

# 3. Install dependencies
# Copy package.json and lock file first to leverage Docker cache
COPY package.json ./
COPY package-lock.json ./
RUN npm install --frozen-lockfile

# 4. Copy the rest of the application code
COPY . .

# 5. Build the Next.js application
RUN npm run build

# 6. Production Image: Create a smaller image for production
FROM node:20-alpine AS production

WORKDIR /app

# Copy built assets from the 'base' stage
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/public ./public

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["npm", "start"]
