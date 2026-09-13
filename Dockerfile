# syntax=docker/dockerfile:1

# ---- 依赖 ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 构建静态产物 ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- Web：nginx 托管静态产物 ----
FROM nginx:1.27-alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

# ---- verify：一次性验收（单测 + 构建 + e2e）----
FROM deps AS verify
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install --with-deps chromium
COPY . .
# 容器内对 web 服务跑验收；PLAYWRIGHT_BASE_URL 由 compose 注入
CMD ["npm", "run", "verify"]
