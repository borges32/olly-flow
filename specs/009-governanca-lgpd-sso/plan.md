# Plano técnico — Spec 009: Governança, SSO e LGPD

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Cofre:** novos `KeyProvider`s (Vault Transit / KMS da ADR-0007), com comandos de rotação e migração.
- **SSO:** mapeamento de grupos sincronizado no login.
- **Versionamento:** diff estruturado + UI de histórico e aprovação "quatro olhos".
- **LGPD:** `Masker` aplicado em todos os pontos de saída de dados e job diário de retenção/partições.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III.3 | Chave mestra no cofre; rotação |
| VI | Adapters para IdP e cofre; sem endpoints inventados |
| VIII.2 | Mascaramento antes de persistir/transmitir; dados entre nós intactos |
| VIII.3 | Retenção por projeto |
| VII.3 | Logins, aprovações e retenção auditados |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/db/crypto` | `VaultTransitKeyProvider` (+ provedor KMS conforme a ADR) |
| `apps/api` | Módulos `sso`, `versions`, `publish-requests`, `masking`, `audit` (consulta/exportação) |
| `apps/worker` | Job de retenção/partições com lock |
| `packages/engine` | `ExecutionRecorder` e publisher aplicando `Masker` |
| `apps/web` | `/admin/sso`, painel de histórico + diff no canvas, `/approvals` de publicação, `/admin/audit`, configurações de projeto |
| `docker-compose.yml` | Vault dev com Transit |

## Design

### §1 Cofre
- **`VaultTransitKeyProvider`:**
  - `wrap` = `transit/encrypt/<key>`; `unwrap` = `transit/decrypt/<key>`;
  - autenticação AppRole ou Kubernetes (`OLLY_VAULT_AUTH=approle|kubernetes`);
  - `currentKeyVersion` lida da chave do Transit.
- **Seleção:** `OLLY_KEY_PROVIDER=env|vault|<kms>`.
- **`pnpm credentials:rotate`:** processa em lotes de 100, recifrando a DEK com a versão atual.
  - Atualiza `key_version`. O checkpoint é o próprio `key_version` (idempotente).
  - Registra o progresso na auditoria.
- **`pnpm credentials:migrate --from env --to vault`:** mesmo mecanismo.
- **Compose:** `vault` dev + script de init (`transit` habilitado, chave `olly-credentials`).

### §2 SSO e grupos
- **Claims:** grupos lidos de `OIDC_GROUPS_CLAIM` (padrão `groups`). Para Entra ID, a interface `GroupResolver` trata o *overage* (`_claim_names`) via Graph, implementada apenas se a ADR-0005 confirmar o Entra.
- **`group_role_mappings (idp_group, project_id NULL, role_id)`:**
  - `project_id` NULL = papel global;
  - coluna `project_members.origin` (`manual` | `idp`).
- **No login:**
  1. calcula os vínculos `idp` esperados;
  2. insere os que faltam e remove os `idp` que não se aplicam mais;
  3. nunca toca nos vínculos `manual`.
- **Inativação:** `users.last_login_at`. Job diário marca `is_active = false` após `OLLY_USER_INACTIVE_DAYS` (90). O guard rejeita usuários inativos.
- Auditoria de `auth.login` e `auth.login_failed`.

### §3 Versões e diff
- **API:**
  - `GET /workflows/:id/versions` (com `message`, autor, data);
  - `GET /workflows/:id/versions/:v`;
  - `GET /workflows/:id/diff?from=&to=`;
  - `POST /workflows/:id/versions/:v/restore`.
- **Diff estruturado:** `{ nodes: { added[], removed[], changed: [{ id, name, params: JsonPatch[], settings: JsonPatch[], position? }] }, edges: { added[], removed[] } }`, usando `fast-json-patch` por nó.
- **UI:**
  - painel "Histórico";
  - modo diff no canvas: nós adicionados em verde, removidos em vermelho (*ghost*) e alterados em amarelo;
  - painel com o patch dos parâmetros;
  - "Restaurar".

### §4 Aprovação de publicação
- **`projects.require_publish_approval`.** Quando ativo, `publish` cria `publish_requests (id, workflow_id, version, requested_by, status, decided_by, comment, timestamps)`.
- **`POST /publish-requests/:id/approve|reject`** (`workflow:publish` no projeto e `decided_by ≠ requested_by`). A aprovação executa a publicação.
- Contador no menu (`GET /publish-requests?status=pending`). Tudo auditado.

### §5 Políticas de dados
- `settings.saveExecutionData` (padrão do projeto). Com `errorsOnly`, ao final com sucesso, apaga `input_data`/`output_data` da execução. Com `none`, o recorder não grava dados.
- Dados acima de `OLLY_INLINE_DATA_LIMIT` (256 KB) vão para o MinIO em `executions/<id>/<node>/<run>.json`, com `data_ref`. A API lê de forma transparente.

### §6 Masker
- `masking_rules (id, scope: global|project, project_id, kind: field|pattern, matcher, action: redact|partial|hash, enabled)`.
- **Matchers de campo:** glob sobre o caminho (`*.cpf`, `*token*`).
- **Padrões de valor:**
  - CPF e CNPJ (com dígito verificador);
  - e-mail;
  - cartão (Luhn);
  - telefone BR;
  - JWT (`eyJ...`);
  - chaves `sk-`/`AKIA`.
- **Ações:**
  - `redact` → `"***"`;
  - `partial` (CPF → `***.***.789-**`);
  - `hash` → `sha256(salt + valor)`, com `OLLY_MASKING_SALT` por instalação.
- **Aplicação:** função pura `mask(value, rules)` que percorre objetos e arrays e substitui também ocorrências dentro de strings. Aplicada no `ExecutionRecorder`, no publisher de eventos WebSocket e como *serializer* do pino. **Nunca** no fluxo entre nós.
- **Seed:** regras padrão (FR-016) ativas.

### §7 Retenção e partições
- Job diário (BullMQ repeatable + lock Redis `retention-lock`):
  1. `olly_ensure_partitions(2)`;
  2. por projeto, apaga os dados (`input_data`/`output_data`/`data_ref` + objetos) das execuções mais antigas que `retention.dataDays` (30);
  3. `DETACH PARTITION` + `DROP` das partições mais antigas que o maior `retention.metadataDays` (365);
  4. registra as contagens na auditoria.

### §8 Auditoria
- **`GET /audit`** (`audit:read`): filtros por usuário, ação, entidade e período; paginação por cursor.
- **`GET /audit/export.csv`:** *streaming* com cursor de banco (`pg-query-stream`) e `reply.raw`.
- UI `/admin/audit` com detalhe (diff quando houver).

### §9 `execution:readData` por projeto
- `projects.executor_can_read_data` (padrão false). A `AbilityFactory` concede a permissão ao executor quando a opção está ativa. Atualizar a matriz RBAC.

## Modelo de dados

- Novas tabelas `group_role_mappings`, `publish_requests` e `masking_rules`.
- Novas colunas `project_members.origin`, `users.last_login_at`, `workflow_versions.message`, `projects.require_publish_approval`, `projects.executor_can_read_data`, `projects.retention` (JSONB) e `node_executions.data_ref`.
- Acrescentadas na implementação (ver Histórico): `projects.save_execution_data`, `node_executions.data_masked` e `credentials.key_provider`. `workflow_versions.message` e `node_executions.data_ref` já existiam desde as specs 002/003.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `OLLY_KEY_PROVIDER` | `env` | `env` \| `vault` \| `<kms>` |
| `OLLY_VAULT_ADDR`, `OLLY_VAULT_AUTH`, `OLLY_VAULT_ROLE_ID`, `OLLY_VAULT_SECRET_ID`, `OLLY_VAULT_TRANSIT_KEY` | — | Vault |
| `OIDC_GROUPS_CLAIM` | `groups` | Claim de grupos |
| `OLLY_USER_INACTIVE_DAYS` | 90 | Inativação |
| `OLLY_INLINE_DATA_LIMIT` | 262144 | Limite inline de dados |
| `OLLY_MASKING_SALT` | — | Salt do hash (obrigatório em produção) |
| `OLLY_MASTER_KEY_VERSION` / `OLLY_MASTER_KEYS_PREVIOUS` | 1 / — | Rotação do provedor `env` |
| `OLLY_VAULT_TRANSIT_MOUNT`, `OLLY_VAULT_K8S_ROLE`, `OLLY_VAULT_NAMESPACE` | `transit` / — / — | Vault |
| `OLLY_RETENTION_DATA_DAYS` / `OLLY_RETENTION_METADATA_DAYS` | 30 / 365 | Retenção padrão (pendente do DPO) |
| `OLLY_MAINTENANCE_CRON` | `0 3 * * *` | Job diário |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Mascaramento na saída (persistência/transmissão) | Mascarar na entrada | Os nós precisam dos valores reais |
| Vínculos com origem | Sobrescrever tudo no login | Preserva os ajustes manuais |
| Vault Transit | Guardar a KEK no Vault KV | A KEK nunca sai do Vault |

## Permissões RBAC

Regra geral (decisão de 03/10/2026): cada spec é responsável pelas permissões que introduz: aplicá-las nas rotas (`@RequirePermission`), garantir que constem do catálogo (`packages/shared-types/src/rbac.ts`), do seed de papéis e de `docs/arquitetura/contratos.md`, e testar o acesso negado por papel.

| Permissão | Situação no catálogo/seed | Papéis com a permissão | O que esta spec faz |
|---|---|---|---|
| `audit:read` | Já presente desde a spec 001 | somente admin | Exigir na consulta e exportação da auditoria |
| `execution:readData` (executor) | Presente; o executor não a tem por padrão | executor, quando `projects.executor_can_read_data` | Concessão condicional por projeto na `AbilityFactory` (plan §9) |

O mapeamento de grupos do IdP para papéis (`group_role_mappings`) reutiliza os papéis existentes; nenhuma permissão nova é criada. Atualizar `docs/rbac-matriz.md`.

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001–FR-003 | Integração | `vault-key-provider.int.test.ts`, `rotate.int.test.ts` (SC-002) |
| FR-004–FR-007 | Integração + E2E | `sso-groups.int.test.ts` (SC-001) |
| FR-008–FR-010 | Integração + E2E | `versions-diff.int.test.ts`, `diff.spec.ts` (SC-005) |
| FR-011 | Integração | `publish-approval.int.test.ts` (SC-006) |
| FR-012, FR-013 | Integração | `save-policy.int.test.ts` (SC-004) |
| FR-014–FR-016 | Unidade + integração | `masker.test.ts`, `masking-e2e.int.test.ts` (SC-003) |
| FR-017 | Integração | `retention.int.test.ts` (SC-007) |
| FR-018 | Integração | `audit-export.int.test.ts` (SC-008) |
| FR-019 | Integração | Matriz RBAC atualizada |

## Riscos

| Risco | Mitigação |
|---|---|
| IdP/cofre institucionais indisponíveis | Adapters + ambiente local; pendência registrada |
| Falsos positivos no mascaramento | Validação de dígitos verificadores (CPF/CNPJ/Luhn) |

Ao concluir, produzir `docs/governanca.md` e `docs/lgpd.md` e atualizar `docs/rbac-matriz.md`.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Seção "Permissões RBAC" e tarefa T089 | Decisão humana: cada spec acrescenta e garante as permissões que cria |
| 05/10/2026 | §1: `KeyProvider` com `id`, `wrap` devolvendo a versão (Vault: lida do ciphertext) e `currentKeyVersion` assíncrono; `KeyRing` com todos os provedores configurados (migração sem parada); coluna `credentials.key_provider` como checkpoint; `rewrap` recifra só a DEK. Vault via API HTTP (sem SDK). Compose com Vault em armazenamento de arquivo e unseal automático (o modo `-dev` perderia a chave ao reiniciar) | Rotação e migração idempotentes, sem downtime |
| 05/10/2026 | §2: o login é registrado por `POST /auth/login` (chamado pelo frontend após o IdP); a sincronização dos grupos também ocorre quando um token novo traz outros grupos. Papel global por grupo é resolvido a cada requisição a partir do token (não cria vínculos). `GroupResolver` padrão lê a claim; o resolvedor do Entra (overage) aguarda a ADR-0005 | A API é servidor de recursos OIDC: não vê o login no IdP |
| 05/10/2026 | §3: a mensagem de publicação vira a mensagem da versão quando ela não tem uma (sempre na auditoria) | Não reescrever o histórico |
| 05/10/2026 | §4: um pedido pendente por workflow; o autor pode cancelar; o banco também impede autor = aprovador (`CHECK`); escopo RBAC `{ publishRequest }` | FR-011 |
| 05/10/2026 | §5: coluna `projects.save_execution_data` (padrão do projeto); a política vale só para produção | FR-012 (spec, Histórico) |
| 05/10/2026 | §6: só detectores embutidos e globs de campo (sem regex livre, risco de ReDoS); coluna `node_executions.data_masked` impede reaproveitar dados mascarados; cache das regras invalidado pelo Redis (`olly:masking-rules-changed`) | FR-015/FR-016 |
| 05/10/2026 | §7: a remoção de metadados roda antes da de dados; metadados removidos por projeto e partições descartadas pela maior retenção; job no worker como *job scheduler* do BullMQ (fila `maintenance`) | Evita trabalho duplicado; respeita a retenção de cada projeto |
| 05/10/2026 | §8: exportação por paginação por chave em lotes (sem `pg-query-stream`) | Mesma garantia de memória sem dependência nova |
| 05/10/2026 | §9: a concessão condicional de `execution:readData` fica no `ProjectPermissionResolver` (e não na `AbilityFactory`) | `/me`, rotas e WebSocket veem a mesma permissão |
| 05/10/2026 | `audit:read`, `user:manage` e as regras globais de mascaramento valem só no escopo da plataforma | A auditoria e os usuários são da plataforma, não de um projeto |
| 05/10/2026 | §6: o mascarador percorre só objetos simples (de qualquer realm) e arrays, ignora referências cíclicas e oculta (`***`) um campo sensível cujo valor não vira JSON. Instâncias de classe ficam como estão | Correção: o pino entrega `{ res }` do pino-http cru ao `formatters.log`; percorrer o `ServerResponse` deixava a API em 100% de CPU, sem ficar saudável |
| 06/10/2026 | `node_executions.data_masked` deixa de impedir o reaproveitamento nas execuções de teste: o nó reaproveitado entrega os dados gravados (com os campos mascarados), a nova linha herda `data_masked`, e a execução e o evento `nodeFinished` informam `maskedFields` (caminhos com `***` ou `sha256:`). Produção não reaproveita dados | FR-015 revisado (decisão do PO) |
| 06/10/2026 | FR-006: a inativação por falta de uso preserva o administrador ativo de acesso mais recente quando inativaria todos (spec 014, FR-009); o mesmo job apaga as sessões locais encerradas há mais de 7 dias | Spec 014: a plataforma não pode ficar sem administrador |
