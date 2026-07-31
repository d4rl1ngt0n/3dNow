# The slicer is installed when the application image is built, never from an
# uploaded file or at runtime. This makes every deployment self-contained.
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY vite.config.js ./
COPY client ./client
RUN npm run build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends prusa-slicer xvfb xauth \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /home/node/.config /var/lib/3dnow \
  && chown -R node:node /home/node /var/lib/3dnow
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production \
    PORT=3000 \
    PRUSA_SLICER_PATH=prusa-slicer \
    HOME=/home/node
RUN mkdir -p server/uploads server/output/gcode \
  && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
