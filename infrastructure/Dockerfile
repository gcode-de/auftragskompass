FROM node:24.21.0-bookworm-slim AS build
WORKDIR /app
# Baked into the admin bundle at build time so the UI can show the deployed revision.
ARG AK_BUILD_REVISION=development
RUN npm install --global pnpm@10.2.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN AK_BUILD_REVISION="$AK_BUILD_REVISION" pnpm build

FROM build AS runtime
ENV NODE_ENV=production
USER node
CMD ["node", "apps/api/dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS admin
COPY infrastructure/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html

COPY --from=build /app/apps/widget/dist /usr/share/nginx/html/inquiry-widget
