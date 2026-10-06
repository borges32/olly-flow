# Credenciais

Credenciais guardam os dados de acesso a APIs e bancos usados pelos nós. Introduzidas na [spec 004](../specs/004-credenciais-http-postgres/spec.md).

## Tipos

| Tipo | Campos (secretos em **negrito**) | Teste ("Testar") |
|---|---|---|
| `httpBearer` | **token** | GET na URL informada |
| `httpBasic` | user, **password** | GET na URL informada |
| `httpHeaderAuth` | name, **value** | GET na URL informada |
| `httpQueryAuth` | name, **value** | GET na URL informada |
| `oauth2ClientCredentials` | tokenUrl, clientId, **clientSecret**, scope, authentication (`header` ou `body`) | Obtém um token |
| `postgres` | host, port (5432), database, user, **password**, ssl (`disable`, `require`, `verify-full`), caCert, readOnly | `SELECT 1` |
| `webhookHeaderAuth` | name, **value** | — (autentica chamadas recebidas pelo Webhook, spec 005) |
| `webhookBasicAuth` | user, **password** | — |
| `webhookHmac` | **secret**, headerName (`X-Signature`), algorithm (`sha256`, `sha1`, `sha512`), encoding (`hex`, `base64`) | — |

O teste dos tipos HTTP passa pelo filtro anti-SSRF, como as requisições dos nós.

## Uso

- A tela **Credenciais** lista as credenciais do projeto. Criar, editar, testar e excluir exige `credential:manage`; ver a lista e usar credenciais em nós exige `credential:use` (papéis padrão: administrador e editor).
- **Campos secretos:** nunca voltam da API. Ao editar, aparecem vazios; deixar em branco mantém o valor atual.
- No painel do nó, o campo **Credencial** lista as credenciais do projeto com tipo aceito pelo nó.
- **Ao salvar o workflow:** associar uma credencial a um nó exige `credential:use`. A credencial precisa ser do mesmo projeto e de um tipo aceito pelo nó.
- **Na execução de teste:** quem não tem `credential:use` (ex.: papel executor) só executa um workflow que usa credenciais exatamente como está salvo.
- **Na execução:** a credencial precisa ser do projeto do workflow.

## Segurança

- **Envelope encryption:** cada credencial tem uma chave de dados própria (AES-256-GCM). A chave de dados é cifrada pela chave mestra do `KeyProvider`. O id da credencial entra como dado autenticado, então trocar envelopes entre registros faz a decifragem falhar.
- **Provedor `env`** (desenvolvimento): chave mestra em `OLLY_MASTER_KEY` (base64 de 32 bytes; gere com `openssl rand -base64 32`). A API não sobe sem ela.
- **Provedor `vault`** (spec 009): a chave mestra fica no Vault Transit e nunca sai dele. Rotação e migração sem parada: ver [governanca.md](governanca.md#cofre-da-chave-mestra-fr-001-a-fr-003). O provedor institucional definitivo depende da [ADR-0007](adr/0007-gestao-de-segredos.md).
- **Respostas da API:** levam só os campos públicos (`publicFields`) e a lista de campos secretos preenchidos.
- **Mascaramento:** além das regras LGPD da spec 009 ([lgpd.md](lgpd.md)), os valores secretos e as formas derivadas (Basic em base64, token OAuth2 obtido), viram `***` em tudo que é gravado ou transmitido sobre a execução: log de execução, eventos em tempo real, mensagens de erro e logs dos nós. Os dados que passam entre os nós não mudam.
- **Auditoria:** criação, alteração (só os nomes dos campos), teste e exclusão vão para a auditoria, sem valores.
- Um teste automatizado faz uma varredura com valores sentinela em respostas, logs e banco (`credential-leak.int.test.ts`).

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_KEY_PROVIDER` | `env` | Provedor da chave mestra |
| `OLLY_MASTER_KEY` | — (obrigatória) | Chave mestra do provedor `env` |
| `OLLY_HTTP_ALLOWLIST` | vazio | Hosts e CIDRs internos liberados para o nó HTTP e o teste de credencial |
| `OLLY_HTTP_MAX_RESPONSE_MB` | 50 | Limite de resposta HTTP |
| `OLLY_PG_POOL_MAX` | 5 | Conexões por credencial Postgres |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION` | — | Object storage dos binários. Sem `S3_ENDPOINT`, resposta binária do nó HTTP falha |
