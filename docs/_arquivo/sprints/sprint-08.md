# Sprint 8 — Governança: cofre, versionamento, logs LGPD e SSO institucional

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também os relatórios em `docs/relatorios/`, as ADRs 005 e 007 em `docs/decisoes.md` e as seções 7, 8 e 9 de `docs/analise_implementacao.md`.

## Pré-requisitos

- Sprint 7 concluída e todos os comandos da seção 8 passando.
- **Humano:** ADR-005 (IdP institucional) e ADR-007 (Vault/KMS) decididas, com os dados de conexão de homologação disponíveis:
  - **se ainda não estiverem decididas**, implemente os adapters contra Keycloak e HashiCorp Vault locais (dev) e registre a pendência. **Não** invente endpoints ou configurações institucionais.

## Contexto

A plataforma precisa atender aos requisitos institucionais:
- segredos sob gestão corporativa;
- rastreabilidade de alterações em workflows;
- proteção de dados pessoais nos logs (LGPD);
- login com as contas da instituição e papéis atribuídos pelos grupos do diretório.

## Objetivo

Integrar o cofre de chaves e o IdP institucional, versionar workflows com histórico e aprovação opcional, e aplicar mascaramento e retenção aos logs de execução.

## Tarefas

### T1 — `KeyProvider` corporativo
- Implemente `VaultTransitKeyProvider` (HashiCorp Vault, *Transit secrets engine*: `encrypt`/`decrypt` da DEK) e/ou o provedor de KMS definido na ADR-007. Seleção por `OLLY_KEY_PROVIDER=env|vault|<kms>`.
- Autenticação no Vault via AppRole ou Kubernetes auth, configurável. Nenhum token fixo em código.
- **Rotação de chave:**
  - comando `pnpm credentials:rotate` recifra todas as DEKs com a versão atual da KEK, em lotes, atualizando `key_version`;
  - é idempotente e retomável;
  - o progresso é registrado na auditoria.
- Migração `env` → `vault`: comando que recifra as credenciais existentes.
- Adicione o Vault ao Docker Compose (modo dev) com o Transit habilitado por script de init.

### T2 — SSO institucional e mapeamento de grupos
- Valide o OIDC contra o IdP definido na ADR-005. Se o IdP for Entra ID, trate o claim `groups` (com *overage* via Graph, se necessário, atrás de interface) e o `tid`.
- **Mapeamento grupo → papel:**
  - tabela `group_role_mappings (idp_group, project_id NULL = global, role_id)`;
  - tela em `/admin/sso`;
  - no login, sincroniza `project_members` com origem `idp`. Vínculos manuais ficam com origem `manual` e não são removidos pela sincronização.
- O usuário desativado no IdP perde o acesso no próximo login ou refresh. O job diário marca como inativos os usuários sem login há `OLLY_USER_INACTIVE_DAYS`.
- Registre todos os logins e falhas de login em `audit_log`.

### T3 — Versionamento de workflows
- **API:**
  - `GET /workflows/:id/versions` (autor, data, mensagem);
  - `GET /workflows/:id/versions/:v`;
  - `GET /workflows/:id/diff?from=&to=`: diff estruturado (nós adicionados, removidos e alterados, com diff de parâmetros; arestas adicionadas e removidas);
  - `POST /workflows/:id/versions/:v/restore`: cria uma nova versão com o conteúdo de `v`.
- Mensagem de versão opcional ao salvar e obrigatória ao publicar.
- **UI:**
  - painel "Histórico" no editor;
  - **diff visual** no canvas (nós adicionados em verde, removidos em vermelho e alterados em amarelo), com detalhe dos parâmetros alterados;
  - botão "Restaurar".

### T4 — Fluxo de aprovação para publicação ("quatro olhos")
- Configuração por projeto: `projects.require_publish_approval`.
- **Quando ativo**, `publish` cria uma `publish_requests` (`pending`). Outro usuário com `workflow:publish` no projeto — **nunca o próprio autor** — aprova ou rejeita com comentário. Na aprovação, a versão é publicada.
- Notificação in-app de pedidos pendentes (contador no menu). E-mail fica fora do escopo.
- Tudo auditado.

### T5 — Políticas de dados de execução
- `workflows.settings.saveExecutionData`: `all` | `errorsOnly` | `none`. Com `errorsOnly`, os dados são descartados ao final das execuções com sucesso; com `none`, só os metadados são gravados. Padrão por projeto.
- Payloads de nó acima de `OLLY_INLINE_DATA_LIMIT` (padrão 256 KB) vão para o MinIO/S3. O registro guarda `data_ref`, e a API faz a leitura transparente.

### T6 — Mascaramento (LGPD)
- **Regras de mascaramento** globais e por projeto (tabela `masking_rules`):
  - por **nome de campo**, com glob/regex sobre o caminho (ex.: `*.cpf`, `*.senha`, `*token*`);
  - por **padrão de valor**: CPF, CNPJ, e-mail, cartão de crédito (com Luhn), telefone BR, JWT, chaves no formato `sk-...`.
  - Ação: `redact` (`"***"`), `partial` (ex.: `***.***.789-**`) ou `hash` (SHA-256 com *salt* por instalação, para permitir correlação).
- Aplicado **antes de persistir** `input_data`/`output_data`, antes de publicar eventos no WebSocket e nos logs pino. **Nunca altera** os dados que trafegam entre os nós durante a execução.
- **Regras padrão** ativas de fábrica: CPF, CNPJ, senha, token, authorization, cartão.
- Testes com dados aninhados, arrays e strings que contêm CPF no meio do texto.

### T7 — Retenção e partições
- Job diário (BullMQ repeatable, executado por um único worker via *lock*) que:
  - cria as partições dos próximos 2 meses;
  - remove os **dados** (payloads) de execuções mais antigas que `retention.dataDays` (padrão 30), por projeto;
  - remove **partições inteiras** de metadados mais antigas que `retention.metadataDays` (padrão 365), com `DETACH` + `DROP`;
  - remove os objetos correspondentes no MinIO.
- O job registra na auditoria o que removeu (contagens).

### T8 — Tela de auditoria
- `GET /api/v1/audit` (`audit:read`) com filtros (usuário, ação, entidade, período), paginação por cursor e exportação CSV (*streaming*).
- UI `/admin/audit` com filtros e detalhe do registro (diff quando aplicável).

### T9 — Permissão `execution:readData` configurável
- Configuração por projeto, que define se o papel `executor` recebe `execution:readData` (padrão: não).
- Atualize a matriz de RBAC e `docs/rbac-matriz.md`.

## Fora do escopo

MCP, AI Agent, notificações por e-mail e Kubernetes.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Login com usuário do IdP (homologação ou Keycloak dev) atribui o papel pelo grupo | E2E |
| 2 | Credenciais criadas com `OLLY_KEY_PROVIDER=vault` funcionam; a rotação recifra tudo sem downtime | Integração |
| 3 | CPF em payload aparece mascarado no banco, no WebSocket e nos logs, mas o nó seguinte recebe o valor original | Integração |
| 4 | `saveExecutionData: errorsOnly` não guarda dados de execuções com sucesso | Integração |
| 5 | Diff entre versões mostra os nós e parâmetros alterados; restaurar cria uma nova versão | E2E |
| 6 | Com aprovação ativa, o autor não consegue aprovar o próprio pedido | Integração |
| 7 | Job de retenção remove dados antigos e partições expiradas, e registra na auditoria | Integração |
| 8 | Exportação CSV da auditoria com 100 mil registros não estoura memória | Integração |
| 9 | Toda a suíte das sprints anteriores verde | CI |

## Entrega

Código, `docs/governanca.md` (cofre, SSO, versionamento, aprovação), `docs/lgpd.md` (mascaramento e retenção), `docs/rbac-matriz.md` atualizado e o relatório `docs/relatorios/sprint-08.md`.
