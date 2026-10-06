# Relatório — Spec 009: Governança: cofre, SSO institucional, versionamento e LGPD

**Status:** Implementada com pendências (decisões institucionais: ADR-0005, ADR-0007 e prazos do DPO)
**Data:** 05/10/2026

## Resumo

- **Cofre:**
  - chave mestra das credenciais no **Vault Transit** (`OLLY_KEY_PROVIDER=vault`, AppRole ou Kubernetes, sem token fixo) ou no provedor local `env`;
  - rotação e migração `env → vault` idempotentes, retomáveis e auditadas, sem parar a API (`pnpm credentials:rotate` / `credentials:migrate`);
  - Vault de desenvolvimento no compose.
- **SSO:**
  - grupos do IdP (claim configurável) mapeados para papéis por projeto ou globais;
  - sincronização no login sem tocar nos vínculos manuais;
  - inativação por falta de login e reativação;
  - auditoria de login e de falhas de login.
- **Versionamento:**
  - histórico com mensagem (opcional ao salvar, obrigatória ao publicar);
  - diff estruturado (JSON Patch por nó) e diff visual no canvas;
  - restauração como nova versão.
- **Aprovação "quatro olhos"** da publicação por projeto, com contador no menu.
- **LGPD:**
  - mascaramento por nome de campo e por padrão de valor (CPF/CNPJ com dígito verificador, cartão com Luhn, e-mail, telefone, JWT, chaves de API) no banco, no WebSocket e nos logs, sem alterar os dados entre os nós;
  - política de dados (tudo, só erros, nada);
  - dados grandes no object storage;
  - job diário de retenção, partições e inativação;
  - auditoria filtrável com exportação CSV em *streaming*;
  - opção "Executor vê os dados".

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `infra/migrations/0009_governanca.{up,down}.sql` (+ colunas `projects.save_execution_data`, `node_executions.data_masked`, `credentials.key_provider`; ver Desvios) |
| T002 | ✅ | Serviço `vault` no `docker-compose.yml`; `infra/vault/start-dev.sh` (armazenamento em arquivo, unseal automático) e `infra/vault/init.sh` (Transit, AppRole, políticas), usado também pelos testes |
| T010 | ✅ | `packages/engine/src/masking.ts` (`createMasker`, detectores, ações) + `masking.test.ts` |
| T011 | ✅ | Regras padrão na migration; `apps/api/src/masking/` (serviço com cache e invalidação pelo Redis, CRUD global e por projeto) |
| T012 | ✅ | `ExecutionRecorder` (banco e eventos), log do pino (`masking/log-masking.ts`) na API e no worker; `masking-e2e.int.test.ts` |
| T020 | ✅ | `packages/db/src/vault.ts` (`VaultTransitKeyProvider`), `keyring.ts` (`createKeyRing`), `crypto.ts` (`KeyRing`, envelope com `kp`) |
| T021 | ✅ | `apps/api/src/credentials/key-rotation.ts`, `apps/api/src/cli/credentials.ts`; scripts `credentials:rotate` e `credentials:migrate` |
| T030 | ✅ | `auth/group-resolver.ts` (claim configurável; overage do Entra registrado, ver Pendências), `auth/idp-group-sync.ts`, `ProjectPermissionResolver` (papéis globais) |
| T031 | ✅ | `sso/sso.service.ts` (`POST /auth/login`, inativação manual) e `maintenance/maintenance.service.ts` (inativação diária) |
| T032 | ✅ | `apps/web/src/pages/admin-sso-page.tsx` + `e2e/governance.spec.ts` (Keycloak real) |
| T040 | ✅ | Política no `ExecutionRecorder`/`ExecutionRunner`; `executions/node-data.ts` (dados no storage com leitura transparente) |
| T041 | ✅ | `maintenance/maintenance.service.ts` + `maintenance.scheduler.ts` (fila BullMQ `maintenance`, lock no Redis) |
| T050 | ✅ | `workflows/diff.ts`, rotas de versão, diff e restauração; mensagem obrigatória em `POST /workflows/:id/publish` |
| T051 | ✅ | `apps/web/src/editor/version-history.tsx`, `version-diff.ts`, marcações em `workflow-node.tsx`/`workflow-edge.tsx` |
| T060 | ✅ | `webhooks/publish-approvals.service.ts`, `publish-requests.controller.ts`; `apps/web/src/pages/approvals-page.tsx`; contador no menu |
| T061 | ✅ | `audit/audit-query.service.ts`, `audit.controller.ts`; `apps/web/src/pages/admin-audit-page.tsx` |
| T062 | ✅ | `projects.executor_can_read_data` no `ProjectPermissionResolver`; matriz RBAC regenerada |
| T089 | ✅ | `audit:read` só admin no seed (já estava) e exigida no escopo global; concessão condicional testada na matriz |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Tabelas abaixo |
| T092 | ✅ | [`docs/governanca.md`](../../docs/governanca.md), [`docs/lgpd.md`](../../docs/lgpd.md), [`docs/rbac-matriz.md`](../../docs/rbac-matriz.md), `docs/arquitetura/modelo-dados.md`, `contratos.md`, `docs/credenciais.md`, `README.md`, `.env.example` |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim (Vault; KMS aguarda a ADR-0007) | `apps/api/src/credentials/vault-key-provider.int.test.ts` › "FR-001: a DEK é cifrada pelo Vault…", "FR-001: seleção por configuração, sem token fixo…"; `config.test.ts` › "spec 009 — FR-001/…" |
| FR-002 | Sim | `vault-key-provider.int.test.ts` › "FR-002/SC-002/NFR-001: recifra tudo na versão nova enquanto a API continua decifrando"; `packages/db/src/crypto.test.ts` › "FR-002: recifra a DEK…" |
| FR-003 | Sim | `vault-key-provider.int.test.ts` › "FR-003: credenciais cifradas com `env` passam para o Vault…"; `crypto.test.ts` › "FR-003: envelope sem provedor…" |
| FR-004 | Sim (OIDC genérico; Keycloak local) | `apps/api/src/sso/sso-groups.int.test.ts` › "FR-004: o login aceita token do IdP OIDC…" |
| FR-005 | Sim | `sso-groups.int.test.ts` › "FR-005/SC-001…", "FR-005: vínculo manual prevalece…", "FR-005: grupo mapeado para papel global…"; `apps/web/e2e/governance.spec.ts` › "SC-001/FR-005…" |
| FR-006 | Sim | `sso-groups.int.test.ts` › "FR-006: sem login há N dias → inativo…", "FR-006: desativação manual corta o acesso na hora" |
| FR-007 | Sim | `sso-groups.int.test.ts` › "FR-007: login e falha de login são auditados, sem o token" |
| FR-008 | Sim | `apps/api/src/workflows/versions-diff.int.test.ts` › "FR-008/SC-005: diff…", "FR-008/SC-005: restaurar cria uma nova versão…" |
| FR-009 | Sim | `versions-diff.int.test.ts` › "FR-009: mensagem opcional ao salvar…", "FR-009: a mensagem é obrigatória ao publicar…" |
| FR-010 | Sim | `apps/web/src/editor/version-diff.test.ts` › "FR-010: …"; `e2e/governance.spec.ts` › "FR-010/SC-005: compara versões no canvas e restaura…" |
| FR-011 | Sim | `apps/api/src/webhooks/publish-approval.int.test.ts` (5 casos "FR-011…/SC-006…") |
| FR-012 | Sim | `apps/api/src/executions/save-policy.int.test.ts` › "FR-012/SC-004…", "FR-012: \"nada\"…", "FR-012/FR-013…" |
| FR-013 | Sim | `save-policy.int.test.ts` › "FR-013: acima do limite, os dados vão para o storage…" |
| FR-014 | Sim | `packages/engine/src/masking.test.ts` (FR-014); `apps/api/src/masking/masking-e2e.int.test.ts` › "FR-014/FR-015/SC-003…", "FR-014/SC-003: mensagens de erro e logs…" |
| FR-015 | Sim | `masking-e2e.int.test.ts` › "FR-014/FR-015/SC-003…", "FR-015: execução parcial não reaproveita dados mascarados"; `masking.test.ts` › "FR-015: o valor original nunca é alterado" |
| FR-016 | Sim | `masking-e2e.int.test.ts` › "FR-016: regras padrão…", "FR-016: regra do projeto vale só no projeto…"; `masking.test.ts` › "FR-016…" |
| FR-017 | Sim | `apps/api/src/maintenance/retention.int.test.ts` › "FR-017/SC-007…", "FR-017: lock no Redis…" |
| FR-018 | Sim | `apps/api/src/audit/audit-export.int.test.ts` (4 casos); `rbac-matrix.int.test.ts` (linha "Consultar e exportar a auditoria") |
| FR-019 | Sim | `apps/api/src/rbac/rbac-matrix.int.test.ts` › "FR-017/SC-004 e spec 009 FR-018/FR-019…" (projeto com "Executor vê os dados") |
| NFR-001 | Sim | Rotação com leituras contínuas sem falha (`vault-key-provider.int.test.ts`) |
| NFR-002 | Sim (folga pequena) | Medição abaixo; `masking.test.ts` › "NFR-002: …" |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | E2E com o Keycloak do compose: o grupo `viewer` mapeado para Executor do projeto dá o papel no login; sem o mapeamento, o papel herdado sai (`governance.spec.ts`); a mesma regra com IdP de teste em `sso-groups.int.test.ts` |
| SC-002 | ✅ | 120 credenciais recifradas da versão 1 para a 2 do Transit, com leituras contínuas sem falha; interrupção no meio e retomada; repetição sem efeito (`vault-key-provider.int.test.ts`) |
| SC-003 | ✅ | CPF e senha mascarados no banco, nos eventos do WebSocket e nos logs (objeto e mensagem); o nó seguinte confirma ter recebido o original (`masking-e2e.int.test.ts`) |
| SC-004 | ✅ | Com "só erros", a execução com sucesso fica sem `input_data`/`output_data`/`data_ref` e sem objetos no storage; a com erro guarda (`save-policy.int.test.ts`) |
| SC-005 | ✅ | Diff com nós e arestas adicionados, removidos e alterados (patch dos parâmetros); restaurar cria a v3 com a definição da v1 (`versions-diff.int.test.ts`, E2E) |
| SC-006 | ✅ | O autor recebe 403 ao aprovar ou rejeitar o próprio pedido; o banco também recusa (`CHECK`) (`publish-approval.int.test.ts`) |
| SC-007 | ✅ | Dados e metadados expirados removidos por projeto (10/100 dias e padrão 30/365), com os objetos do storage; partição de 420 dias descartada; execução em andamento preservada; `retention.run` auditado; repetição sem efeito (`retention.int.test.ts`) |
| SC-008 | ✅ | 100.000 registros (≈ 77 MB de CSV) exportados com crescimento de **1,4 MB** de memória viva (medida após coleta de lixo, `--expose-gc`); o teste exige < 20 MB (`audit-export.int.test.ts`) |

**NFR-002 (medição registrada):**
- **Cenário:** um gravador de execução real contra o PostgreSQL (Testcontainers), 10 nós × 50 itens por execução, com CPF válido e e-mail em todos os itens e as regras padrão ativas. Mediana de 7 rodadas de 40 execuções.
- **Resultado:** 20,4–20,8 ms sem mascaramento contra 22,4–22,5 ms com ele, um acréscimo de **8,0% a 9,6%** em três execuções do script.
- **Otimizações:** a primeira versão dava 24%; o custo baixou com pré-filtro por dígitos/marcadores, cache por nome de campo e caminho montado só quando há regra por caminho.
- **Remedição após a correção do laço (05/10/2026, ver Desvios):** 8,2–10,4% em quatro execuções (uma fora da curva, 4,4%). Fica dentro da variação da medição original.
- **Ressalva:** a folga é pequena num cenário denso em dados sensíveis. Ver Riscos.

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ (inclui `prettier --check`) |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 552 testes (shared-types 20, db 8, nodes 139, expressions 124, web 65, task-runner 8, engine 107, api 30, raiz 51) |
| `pnpm test:integration` | ✅ 240 testes (api 192 em 31 arquivos, nodes 23, db 22, engine 3); Testcontainers com PostgreSQL, Redis, MinIO e Vault |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 30 testes (inclui `governance.spec.ts` com o Keycloak do compose) |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit` | 1 moderada conhecida (`uuid` via `testcontainers` → `dockerode`, só em testes); nenhuma nova |

## Decisões tomadas

- **Pré-requisitos humanos:**
  - ADR-0005 e ADR-0007 continuam `Proposta`;
  - conforme a própria spec e a seção "Decisões pendentes" do roadmap, a implementação usa Keycloak e Vault locais atrás de interfaces (`GroupResolver`, `KeyProvider`). Nenhum endpoint ou credencial institucional foi inventado.
- **Ordem das specs:** a 009 foi implementada antes da 008 por decisão do PO (05/10/2026; dependência removida do cabeçalho da spec). Nada da 009 depende da 008. O roadmap registra a antecipação.
- **Chave mestra:**
  - `KeyRing` com todos os provedores configurados: a API lê envelopes de qualquer um e cifra com o atual, o que permite migrar sem parar;
  - a rotação recifra só a DEK (`rewrapCredentialData`);
  - com o Vault, a versão vem do próprio ciphertext (`vault:vN:`), então as DEKs novas usam a versão nova logo após `transit/keys/<key>/rotate`, sem reiniciar.
- **Vault no compose:** armazenamento em arquivo com unseal automático, em vez do modo `-dev`, que perderia a chave das credenciais a cada reinício. O compose continua com `OLLY_KEY_PROVIDER=env` por padrão; a migração é demonstrada com o comando.
- **SSO:**
  - a API é servidor de recursos e não vê o login no IdP. O frontend registra o login (`POST /auth/login`) e a sincronização também acontece quando um token novo traz outros grupos;
  - o papel global por grupo é lido do token a cada requisição e não cria vínculos;
  - o resolvedor do Entra ID para *overage* não foi implementado (ADR-0005);
  - "Falha de login" cobre o que chega à plataforma: token inválido e usuário inativo. Senha errada fica nos eventos do IdP.
- **Permissões de plataforma:** `audit:read`, `user:manage` e as regras globais de mascaramento exigem escopo global. O papel admin de um projeto não lê a auditoria da plataforma. A matriz RBAC ganhou a coluna "admin da plataforma".
- **FR-019** foi implementado no `ProjectPermissionResolver`, e não na `AbilityFactory`: assim `/me`, rotas e WebSocket enxergam a mesma permissão.
- **Mascaramento:**
  - só detectores embutidos e globs de campo, sem regex livre (risco de ReDoS na gravação);
  - os globs amplos (`*cpf*`) mascaram também campos como `cpfConferido`, por escolha de segurança;
  - cache das regras invalidado pelo Redis (API e workers);
  - `OLLY_MASKING_SALT` obrigatório em produção.
- **Política de dados:** vale para produção; as execuções de teste guardam sempre (registrado no Histórico da spec).
- **Retenção:** a remoção de metadados roda antes da de dados (evita trabalho duplicado). As partições são descartadas pela maior retenção entre os projetos. O job roda no worker como *job scheduler* do BullMQ.
- **Exportação:** paginação por chave em lotes de 1.000 com contrapressão, em vez de `pg-query-stream`: a mesma garantia de memória, sem dependência nova.

## Desvios da spec/plano

Todos registrados antes no "Histórico de alterações":
- **`spec.md`:** antecipação à 008; FR-012 só para produção; FR-011 com um pedido por workflow e cancelamento pelo autor; FR-015 sem reaproveitar dados mascarados.
- **`plan.md`:** §1 a §9, colunas novas, variáveis novas e permissões só globais.

**Testes de specs anteriores ajustados ao comportamento novo**, sem enfraquecer o que verificam:
- `credential-leak.int.test.ts` (spec 004): o cabeçalho `authorization` agora é ocultado inteiro pela regra padrão. O teste espera `"authorization":"***"` em vez de `Bearer ***` e continua varrendo os segredos.
- `executions.int.test.ts` (spec 005): o campo de exemplo `cpf` passou a ser mascarado. Foi renomeado para `pedido`, já que o teste verifica a permissão `execution:readData`, não o conteúdo.
- Chamadas de publicação nos testes de integração e no `infra/load/setup.ts`: incluem a mensagem obrigatória (FR-009).
- `webhook-code.spec.ts` (E2E da spec 005): preenche a mensagem no diálogo de publicação.
- A matriz RBAC (`docs/rbac-matriz.md`) foi regenerada com as ações novas.
- `project-quota.int.test.ts` (spec 006, SC-006):
  - **causa:** com as duas consultas novas no início de cada execução (regras de mascaramento e política de dados), o pool de conexões frio do worker passou a decidir qual dos jobs simultâneos pega a vaga da cota. O teste assumia que seria sempre o 2º;
  - **ajuste:** agora ele verifica "quaisquer duas rodam e a outra espera até abrir uma vaga", que é o que a spec pede;
  - **mitigação:** as duas consultas passaram a rodar em sequência.
- `graph.test.ts` (web): o teste que carrega o catálogo inteiro de nós ganhou timeout de 30 s, porque sob a suíte em paralelo passava dos 5 s padrão.

**Correção pós-implementação (05/10/2026): API em 100% de CPU e sem ficar saudável num ambiente recriado do zero.**
- **Sintoma:** a API subia, mas o processo ficava preso num laço sem registrar erro.
- **Causa:** o pino chama `formatters.log` antes dos serializers. No log "request completed", o pino-http entrega o `ServerResponse` cru do Node. O mascarador dos logs percorria qualquer objeto até a profundidade 64, e o grafo do `ServerResponse` (socket, req, servidor) é cíclico, com várias referências por nível. O custo virava exponencial.
- **Diagnóstico:** perfil de CPU e pausa pelo inspector no processo do container mostraram `walk` (`masking.js`) com o objeto `{ res, responseTime }`.
- **Por que os testes não pegaram:** a suíte roda com o log em `silent`. O teste de vazamento de segredos usa `trace`, mas com `inject` do Fastify, cujos objetos de requisição são pequenos.
- **Correção (plan §6, Histórico):**
  - o mascarador percorre só objetos simples (de qualquer realm, inclusive sandbox `vm`) e arrays;
  - ignora referências a ancestrais (ciclos);
  - oculta um campo sensível cujo valor não pode ser serializado;
  - instâncias de classe ficam como estão (os serializers do pino as tratam).
- **Testes que reproduzem (falhavam por *timeout* antes da correção):**
  - `masking.test.ts`: objeto cíclico, instância de classe com ciclos, objeto de outro realm e campo sensível cíclico;
  - `log-masking.test.ts` (novo): log com `req`/`res` de uma requisição HTTP real, e campos e textos sensíveis mascarados nos logs.

Observação: o teste de desempenho NFR-002 da spec 003 (`expressions/sandbox.test.ts`, 1.000 itens × 3 expressões em menos de 1 s) falhou uma vez com a máquina carregada (1,4 s) e passou isolado e na verificação final. Ele não foi alterado.

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `fast-json-patch` (`@olly/api`) | 3.1.1 | Diff estruturado RFC 6902 por nó (plan §3) | MIT |
| Imagem `hashicorp/vault` (compose e Testcontainers; não é dependência de código) | 1.20 | Vault Transit de desenvolvimento e testes (ADR-0007) | BUSL-1.1 (uso interno e de desenvolvimento permitido; alternativa compatível: OpenBao, MPL-2.0) |

O cliente do Vault usa `fetch` (API HTTP), sem SDK.

## Pendências, bloqueios e riscos

- **ADR-0005 (IdP):**
  - o login institucional real depende da decisão e de acesso de homologação (o ADR anota "Instituição tem Entra ID/Azure AD");
  - se o Entra ID for confirmado, falta o `GroupResolver` via Microsoft Graph para o *overage* (mais de ~200 grupos) e, possivelmente, o uso de ids de grupo no lugar de nomes nos mapeamentos.
- **ADR-0007 (cofre):** confirmar Vault ou KMS de nuvem. O provedor KMS não foi implementado. Em produção, separar a identidade do comando de rotação (política `olly-key-admin`) da identidade da API (`olly-api`).
- **[PRECISA ESCLARECIMENTO] prazos de retenção:** não resolvido; usados os padrões de 30 dias (dados) e 365 dias (metadados), configuráveis por projeto e por variável.
- **[PRECISA ESCLARECIMENTO] regras adicionais do DPO:** não resolvido; as regras são configuráveis (globais e por projeto). E-mail e telefone estão disponíveis, mas desativados.
- **NFR-002:** a medição fica em torno de 10% (8,0–9,6%; 8,2–10,4% na remedição após a correção do laço) com pouca folga num cenário com CPF em todos os itens. Payloads muito densos em texto podem passar do limite; a medição deve ser repetida no ambiente de homologação (spec 012).
- **Cache de usuários:** desativações (manual em outra instância ou pelo job diário) levam até 30 s para valer nas demais instâncias da API.
- **Falhas de login no IdP** (senha errada) não chegam à plataforma: auditar nos eventos do IdP.
- **Herdadas:** a 006 e a 007 continuam `Implementada` (não `Verificada`); a 008 não foi implementada.

## Como demonstrar

1. `docker compose up -d --wait` (agora com o Vault em `:8200`), `pnpm db:migrate`, `pnpm dev`; abrir <http://localhost:5173>.
2. **SSO** (Administração → SSO e usuários, como `admin@olly.local`):
   - mapear o grupo `viewer` para Executor de um projeto;
   - entrar como `viewer@olly.local` (senha `olly123`): o projeto aparece, e em Administração → projeto o vínculo tem o selo "IdP";
   - remover o mapeamento e entrar de novo: o papel sai.
3. **Mascaramento:**
   - criar um workflow com gatilho manual, dados fixados `{"cpf":"529.982.247-25","senha":"x"}` e um Set que use `{{ $json.cpf }}`;
   - executar: o painel mostra `***.***.247-**` e `***`, enquanto o nó seguinte recebeu o valor real (por exemplo, `{{ $json.cpf === '529.982.247-25' }}` dá `true`);
   - ver as regras em Administração → Mascaramento.
4. **Versões:** salvar duas vezes com mudanças → Histórico → "Comparar com a atual" (cores no canvas e patch no painel) → "Restaurar".
5. **Aprovação:**
   - Administração → projeto → Governança → "Exigir aprovação para publicar";
   - como editor, "Pedir publicação";
   - como outro usuário com permissão de publicar, menu **Aprovações** (com contador) → "Aprovar e publicar".
6. **Política e retenção:** em Governança, "Só execuções com erro" e retenção em dias. O job roda às 03:00 (`OLLY_MAINTENANCE_CRON`).
7. **Auditoria:** Administração → Auditoria (filtros, detalhe, "Exportar CSV").
8. **Cofre:** com o Vault do compose, configurar no `.env` `OLLY_KEY_PROVIDER=vault` (mantendo `OLLY_MASTER_KEY`), reiniciar e rodar:
   - `pnpm credentials:migrate --from env --to vault`;
   - depois, `pnpm credentials:rotate --rotate-vault-key`;
   - o progresso aparece na auditoria.

## Próximos passos sugeridos

- `GroupResolver` do Entra ID (Graph) e mapeamentos por id de grupo, quando a ADR-0005 for decidida.
- Provedor KMS de nuvem, se a ADR-0007 escolher KMS.
- Notificações por e-mail/Teams dos pedidos de aprovação (fora do escopo; backlog).
- Detectores adicionais de valor (RG, CNH, PIS), conforme as regras do DPO.
- Mostrar, na tela da execução, quando os dados não foram guardados por causa da política.
