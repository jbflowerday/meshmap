# ---- build
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional build-time customisation (see .env.example)
ARG VITE_SITE_TITLE
ARG VITE_MAP_CENTER
ARG VITE_MAP_ZOOM
ARG VITE_TILE_URL
ARG VITE_TILE_ATTRIBUTION
RUN npm run build

# ---- serve
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
