# Imagens para rodar a API, o worker e o frontend no compose (profile `app`), para testes de UX.
# Não são as imagens de produção (Helm/homologação: spec 012).
#   docker compose --profile app up -d --build --wait

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Variáveis do navegador entram no bundle no build (o Vite lê VITE_* do ambiente).
ARG VITE_OIDC_AUTHORITY=http://localhost:8080/realms/olly
ARG VITE_OIDC_CLIENT_ID=olly-web
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
RUN pnpm turbo run build --filter=@olly/api... --filter=@olly/worker --filter=@olly/web
# Deixa só as dependências de produção para a imagem da API.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && pnpm install --frozen-lockfile --prod --offline

FROM node:22-alpine AS api
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/infra/migrations ./infra/migrations
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api ./apps/api
# Task runner: processo filho da API que avalia expressões com isolated-vm (binário musl incluso).
COPY --from=build /repo/apps/task-runner ./apps/task-runner
COPY infra/docker/db-keeper.sh /usr/local/bin/db-keeper
USER node
EXPOSE 3000
# Migrations e seed ficam no serviço `db-init` do compose (db-keeper).
CMD ["node", "apps/api/dist/main.js"]

# Spec 006: worker de execuções (mesma base da API; consome a fila e tem o próprio task runner).
FROM api AS worker
COPY --from=build /repo/apps/worker ./apps/worker
EXPOSE 3101
CMD ["node", "apps/worker/dist/main.js"]

FROM nginx:1.29-alpine AS web
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
