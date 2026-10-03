# Keycloak — realm de desenvolvimento

`olly-realm.json` é importado pelo `docker-compose.yml` ao subir o Keycloak (`start-dev --import-realm`).

> ⚠️ **Somente desenvolvimento.** Este realm habilita o *password grant* (`directAccessGrantsEnabled`) no client `olly-web` para o smoke test e testes automatizados (NFR-003). Ele **não** deve ser usado como base para homologação ou produção. O IdP institucional é definido pela ADR-0005.

| Item | Valor |
|---|---|
| Emissor | `http://localhost:8080/realms/olly` |
| Client do frontend | `olly-web` (público, Authorization Code + PKCE S256, redirect `http://localhost:5173/*`) |
| Audience da API | `olly-api` (mapper de audience no client `olly-web`) |
| Claim de grupos | `groups` (nome simples do grupo, sem caminho) |
| Console de administração | `http://localhost:8080/admin` (usuário/senha em `KEYCLOAK_ADMIN_USER`/`KEYCLOAK_ADMIN_PASSWORD`) |

## Usuários de teste (FR-003)

Senha de todos: `olly123`.

| Usuário | Nome | Grupo |
|---|---|---|
| `admin@olly.local` | Ana Administradora | `admin` |
| `editor@olly.local` | Eduardo Editor | `editor` |
| `executor@olly.local` | Ester Executora | `executor` |
| `viewer@olly.local` | Vitor Visualizador | `viewer` |

O realm só é importado se ainda não existir. Após alterar o arquivo, recrie o container: `docker compose up -d --force-recreate keycloak`.
