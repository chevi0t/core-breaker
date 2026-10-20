FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY online/package.json online/package-lock.json ./online/
RUN npm ci --prefix online --omit=dev
COPY prototype ./prototype
COPY vendor/three-r128 ./vendor/three-r128
COPY online ./online
COPY sounds/CREDITS.md ./sounds/CREDITS.md
ENV NODE_ENV=production PORT=8080 MAX_ROOMS=1
EXPOSE 8080
CMD ["node", "online/server.cjs"]
