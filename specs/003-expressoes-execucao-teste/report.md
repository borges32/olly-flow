# Relatório — Spec 003: Expressões, variáveis e execução de teste

**Status:** Verificada (revisão humana em 04/10/2026)
**Data:** 03/10/2026

## Resumo

- **Expressões `{{ }}` compatíveis com o N8N:** isolated-vm num processo separado (`apps/task-runner`), avaliação em lote por nó, *paired items*, `$vars`, `$env` filtrado e Luxon.
- **Nós:** `logic.if` (condições tipadas E/OU), `data.setVariable` e `data.set` com expressões e `includeOtherFields`.
- **Execução de teste pelo editor:** sem salvar, com pin data, e um nó por vez pelo botão de executar no próprio nó, reaproveitando os dados anteriores (FR-020, como o "Execute step" do N8N); eventos em tempo real por WebSocket com autorização por sala.
- **Log de execuções:** particionado por mês, com truncamento.
- **Painel do nó em três colunas:** Entrada, Parâmetros e Saída, com visões de tabela, JSON e schema.
- **Editor de expressões:** autocomplete, pré-visualização e arrastar campos.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `0003_executions` + `olly_ensure_partitions(meses)` |
| T002 | ✅ | `pinData` já estava no contrato desde a spec 001 (indexado por id do nó); conferido |
| T010 | ✅ | `packages/expressions/src/template.ts` |
| T011 | ✅ | `apps/task-runner` (processo + `TaskRunnerClient`) |
| T012 | ✅ | Prelude no isolate (`prelude.ts`) + `buildExpressionData` no motor |
| T013 | ✅ | `packages/engine/src/paired.ts` |
| T014 | ✅ | `ExpressionError` |
| T015 | ✅ | `sandbox.test.ts` (isolate) e `client.test.ts` (processo) |
| T016 | ✅ | 76 casos + 7 de erro/imutabilidade; fixture sintética executada pelo motor |
| T020 | ✅ | |
| T021 | ✅ | |
| T022 | ✅ | |
| T023 | ✅ | |
| T030 | ✅ | |
| T031 | ✅ | Mais `GET /executions/:id` (ver "Desvios") |
| T032 | ✅ | Salas `execution:<id>` e `workflow:<id>` |
| T033 | ✅ | O painel do nó (NDV) substitui o painel lateral da spec 002 |
| T034 | ✅ | |
| T035 | ✅ | |
| T036 | ✅ | Acrescentada após o teste de UX (FR-020); ver "Correções após o relatório" |
| T040 | ✅ | Rota `POST /workflows/:id/expressions/preview` |
| T041 | ✅ | Sem Monaco (ver "Desvios") |
| T042 | ✅ | |
| T089 | ✅ | `execution:read` e `workflow:execute` testados por papel (HTTP e WebSocket) |
| T090 | ✅ | |
| T091 | ✅ | |
| T092 | ✅ | `docs/expressoes.md`, `docs/nos/logic.if.md`, `docs/nos/data.setVariable.md`, `docs/nos/data.set.md` e `docs/nos/README.md` |
| T093 | ✅ | |

## Requisitos

Os testes citam `spec 003` no título.

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/expressions/src/template.test.ts`; `compat.test.ts` |
| FR-002 | Sim | `template.test.ts`; `compat.test.ts` (tipos em trecho único e em template misto) |
| FR-003 | Sim | `compat.test.ts` (todas as variáveis da lista, Luxon); `packages/engine/src/expressions.test.ts` (`$execution`, `$workflow`, `$env` vindos do motor) |
| FR-004 | Sim | `compat.test.ts`; `engine/src/expressions.test.ts` › "depois do If, $("Busca").item…"; `apps/api/src/executions/test-run.int.test.ts` |
| FR-005 | Sim | `packages/expressions/src/env.test.ts`; `test-run.int.test.ts` › "FR-005: $env expõe só OLLY_EXPOSED_*" |
| FR-006 | Sim | `packages/expressions/src/sandbox.test.ts`; `apps/task-runner/src/client.test.ts` (processo separado, sem o ambiente da API, reinício) |
| FR-007 | Sim | `compat.test.ts` › erros; `engine/src/expressions.test.ts`; `test-run.int.test.ts`; `apps/web/e2e/test-run.spec.ts` |
| FR-008 | Sim | `packages/nodes/src/data/set/set.test.ts` › "spec 003 — FR-008" |
| FR-009 | Sim | `packages/nodes/src/data/set-variable/set-variable.test.ts`; `engine/src/expressions.test.ts` |
| FR-010 | Sim | `packages/nodes/src/logic/if/if.test.ts` (35 casos) |
| FR-011 | Sim | `test-run.int.test.ts`; `engine/src/expressions.test.ts` (`destinationNodeId`); `test-run.spec.ts` |
| FR-012 | Sim | `apps/api/src/executions/ws.int.test.ts`; `test-run.spec.ts` › SC-001 (com o GET bloqueado: os status só chegam pelo WebSocket) |
| FR-013 | Sim | `ws.int.test.ts` (handshake sem token, membro, não membro, sala do workflow, isolamento); `test-run.int.test.ts` (403/404) |
| FR-014 | Sim | `packages/db/src/partitions.int.test.ts`; `test-run.int.test.ts`; `engine/src/expressions.test.ts` (registros por nó) |
| FR-015 | Sim | `apps/api/src/executions/truncate.test.ts`; `test-run.int.test.ts` › "FR-015" |
| FR-016 | Sim | `engine/src/expressions.test.ts`; `test-run.int.test.ts`; `apps/web/src/editor/store.test.ts`; `test-run.spec.ts` |
| FR-017 | Sim | `test-run.spec.ts` (tabela, JSON, schema, portas do If); `expression-utils.test.ts` (schema) |
| FR-018 | Sim | `apps/web/e2e/drag-field.spec.ts`; `apps/api/src/executions/preview.int.test.ts`; `apps/web/src/editor/expression-utils.test.ts` |
| FR-020 | Sim | `engine/src/expressions.test.ts` › "FR-020…" (reaproveita, não reaproveita destino/fixado, `rerunOnPartialExecution`); `test-run.int.test.ts` › "FR-020…" (reuse, outro workflow, truncado, 400); `migrations.int.test.ts` (0004); `apps/web/src/editor/partial-run.test.ts`; `store.test.ts`; `apps/web/e2e/test-run.spec.ts` › "FR-020/HU-2.4…"; `readonly.spec.ts` (sem botão para quem não executa) |
| FR-019 | Sim | `packages/expressions/src/compat.test.ts`; `packages/engine/src/fixtures.test.ts` |
| NFR-001 | Sim | `sandbox.test.ts` › "SC-003/NFR-001…" (timeout de 100 ms) e "FR-006/NFR-001…" (limite de memória) |
| NFR-002 | Sim | `sandbox.test.ts` › "NFR-002": 3000 expressões em **82 ms** (isolado) e ≈ 350 ms com os testes de todos os pacotes em paralelo; meta < 1 s |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `apps/web/e2e/test-run.spec.ts` › "SC-001…": executa `Manual → Set → If`; os status chegam pelo WebSocket; dados em tabela/JSON/schema |
| SC-002 | ✅ com ressalva | `compat.test.ts`: 76 casos de compatibilidade verdes (meta ≥ 60). Fixture aplicável: só `exemplo-set-if`, **sintética** (`packages/engine/src/fixtures.test.ts`). Não há fixtures reais da POC |
| SC-003 | ✅ | `sandbox.test.ts`, `client.test.ts` (o processo principal continua respondendo) e `test-run.int.test.ts` (`/health` responde em < 1 s durante o laço) |
| SC-004 | ✅ | `sandbox.test.ts`: `process`, `require`, `module`, `fetch`, `constructor.constructor`, `import()` |
| SC-005 | ✅ | `drag-field.spec.ts`: `{{ $json.nome }}` e `{{ $('Início').item.json.nome }}`, com preview `Ana` |

## Comandos de verificação

Executados em 03/10/2026 e repetidos após a execução de um nó por vez (FR-020).

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 340 testes (expressions 106, nodes 66, engine 37, task-runner 6, api 16, web 49, shared-types 12, repositório 48) |
| `pnpm test:integration` | ✅ 98 testes (db 17, api 81) |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 19 testes |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` | ✅ 0 altas; 1 moderada (`uuid`, via Testcontainers, só em testes) |

## Decisões tomadas

1. **isolated-vm 6.2.0.** A 7.x exige Node 24; o projeto usa Node 22 (`stack.md`). O pacote traz binários prontos para Linux glibc e musl (Alpine, usado no Docker), carregados em tempo de execução. O script de instalação está liberado no pnpm só para compilar se faltar binário.
2. **Dois pacotes:**
   - `@olly/expressions` é puro (parser, coleta, referências, tipos), com a subentrada `@olly/expressions/isolate` (o avaliador com isolated-vm);
   - `@olly/task-runner` contém o processo e o `TaskRunnerClient`. A API só carrega o cliente; o isolate vive no processo filho. O filho recebe um ambiente mínimo, sem `DATABASE_URL` nem outros segredos, e é reiniciado com backoff se cair.
3. **Um isolate por execução** (LRU de 32), aquecido na criação, fora do limite da expressão. Sem o aquecimento, a primeira expressão de cada execução estourava os 100 ms sob carga (visto nos testes em paralelo).
4. **Contexto mínimo e imutável:** só os nós referenciados vão para o sandbox (referência dinâmica envia todos os executados), e os dados são congelados. Uma expressão não altera os itens de outra.
5. **Semântica de template misto:** `null` e `undefined` viram vazio, objetos viram JSON e datas viram ISO 8601. O plano só definia objetos; o restante está documentado em `docs/expressoes.md` como comportamento do Olly Flow.
6. **`$node["Nó"]` legado** devolve o item de mesmo índice; `$('Nó').all(n)` segue a ordem das saídas (no If, 0 = Verdadeiro).
7. **`pairedItem` automático** quando a origem é inequívoca (um item de entrada, ou mesma quantidade de itens). Nós que filtram, como o If, preenchem o campo eles mesmos. Consequência na spec 002: o nó desabilitado (repasse) passa a emitir `pairedItem`.
8. **`data.set`:** `includeOtherFields` com padrão `false`, como no N8N atual (plan §5), e `keepOnlySet` como alias oculto (extensão `x-hidden`). Workflows salvos pelo editor da 002 têm `keepOnlySet: false` e não mudam de comportamento. Só nós sem nenhum dos dois parâmetros (criados pela API) passam a manter apenas os campos definidos.
9. **`data.setVariable`:** com vários itens, o último valor prevalece.
10. **`logic.if`:** texto digitado no editor é sempre convertido para o tipo da condição; resultado de expressão precisa ter o tipo certo, salvo com a conversão flexível (como no N8N).
11. **Log:** partições criadas pela migration e pela API (na subida e a cada 12 h), com nova tentativa se faltar partição. Entrada e saída têm metade do limite cada. `input_sources` guarda a origem dos itens; `project_id` é copiado para a autorização.
12. **Execução de teste no processo da API** (plan §7). Na parada, a API espera até 5 s pelas execuções em andamento antes de fechar o banco.

## Desvios da spec/plano

| Desvio | Motivo | Documento atualizado |
|---|---|---|
| Editor de expressões em campo de texto próprio, sem Monaco | Monaco carrega de CDN por padrão e exige workers; para campos de uma linha, o campo próprio atende FR-018 (autocomplete, preview, arrastar) com menos peso (Art. IX.2). Monaco segue previsto para o nó de código (spec 005) | `plan.md` §8 + Histórico |
| Preview em `POST /workflows/:id/expressions/preview` | O escopo RBAC vem do parâmetro de rota | `plan.md` §7 + Histórico |
| Sala `workflow:<id>` (`joinWorkflow`) e buffer de eventos no cliente | O E2E mostrou que execuções rápidas terminavam antes de o editor entrar na sala da execução, e os eventos se perdiam | `plan.md` §7 + Histórico; `contratos.md` |
| `GET /executions/:id`; colunas `input_sources` e `executions.project_id` | Conferência do editor; *paired items* no preview; autorização | `plan.md` + Histórico; `modelo-dados.md` |
| `NodeContext.setVariable`; extensão `x-hidden` | Contrato do `data.setVariable`; alias da spec 002 | `contratos.md`; `docs/nos/README.md` |
| Painel do nó em diálogo (clique duplo ou Enter) no lugar do painel lateral | Três colunas não cabem ao lado do canvas | `plan.md` §8 |

**Ajustes em artefatos da spec 002**, consequências desta spec, sem mudar requisitos verificados:
- os E2E do editor e do somente leitura abrem o painel com clique duplo;
- os testes do motor declaram `includeOtherFields: true`;
- a expectativa do repasse do nó desabilitado inclui `pairedItem`;
- o catálogo `/node-types` passa a ter 4 tipos;
- o zoom por clique duplo no canvas foi desligado.

Também corrigi um defeito do painel: ele fechava sozinho quando o canvas devolvia o foco ao nó.

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `isolated-vm` | 6.2.0 | Stack (sandbox JS, ADR-0003) | ISC |
| `luxon`, `@types/luxon` | 3.7.2 / 3.7.6 | Stack (datas): `$now`, `DateTime` no isolate; `dateTime` no If | MIT |
| `@nestjs/websockets`, `@nestjs/platform-socket.io` | 11.2.7 | Stack (tempo real) | MIT |
| `socket.io`, `socket.io-client` | 4.8.4 | Stack (tempo real); cliente no editor e nos testes | MIT |

Novos workspaces: `@olly/expressions` e `@olly/task-runner`.

## Pendências, bloqueios e riscos

- **Fixtures reais da POC:** ainda não exportadas (pré-requisito desejável da spec). A suíte de compatibilidade segue a documentação do N8N e a fixture sintética; não foi comparada com execuções reais. Quando os workflows chegarem, cada caso entra em `fixtures/n8n/` com o equivalente em `fixtures/olly/`.
- **Não implementado (fora do escopo, documentado):** funções de extensão do N8N (`.toTitleCase()`…), `$jmespath`, `$prevNode`. `$vars` no preview vem vazio (as variáveis não são gravadas no log).
- **Pin data em nós com várias saídas** fixa só a primeira saída (mesmo modelo do contrato `pinData`).
- **Execuções de teste concorrentes** rodam no processo da API, limitadas apenas pelo task runner; a fila chega na spec 006.
- **Atualização de Node:** ao migrar para Node 24, trocar para isolated-vm 7.
- **Vulnerabilidade moderada do `uuid`** (Testcontainers, só testes) continua; não estava na autorização de 03/10.
- **Pré-requisito humano das specs 002–005:** validar a UX do editor com usuários da POC.

## Como demonstrar

```bash
pnpm app:reset          # ou: docker compose up -d --wait && pnpm build && pnpm db:migrate && pnpm db:seed && pnpm dev
```

1. Como `admin@olly.local`, crie um projeto e adicione `editor@olly.local` como Editor (depois de um primeiro login dele).
2. Como editor, crie um workflow com **Gatilho manual → Definir campos → Se (If)**:
   - no gatilho, abra o painel (clique duplo), execute e use **Fixar dados** para editar a entrada (ex.: `[{"nome":"Ana","idade":34},{"nome":"Bruno","idade":16}]`);
   - em **Definir campos**, arraste `nome` do painel de Entrada para o valor de um campo; veja a expressão `{{ $json.nome }}` e o **Resultado**;
   - digite `{{ $json.` para ver as sugestões;
   - no **If**, use a condição `={{ $json.idade }}` `number` `gte` `18`.
3. Clique em **Executar workflow**: os nós mostram o status e a contagem de itens. Abra o If e veja **Verdadeiro (1)** / **Falso (1)** em Tabela, JSON e Schema.
4. Execução passo a passo (FR-020): passe o mouse sobre **Definir campos** e clique no botão de executar (▶) acima do nó. Só ele executa; o If fica sem status. Depois, clique no ▶ do If: ele executa sobre a saída anterior, e o status de **Definir campos** indica "dados da execução anterior". Alterar um nó faz ele, e os seguintes, executarem de novo. O mesmo comando está no painel do nó (**Executar este nó**).
5. Teste uma expressão com laço (`={{ (() => { while (true) {} })() }}`): a execução falha com "Tempo limite da expressão excedido", e a API segue respondendo.
6. Log: `GET /api/v1/executions/:id`, ou no banco: `SELECT node_name, status, items_out FROM node_executions ORDER BY started_at DESC LIMIT 10`.

## Próximos passos sugeridos

- Lista e detalhe de execuções na UI (previsto na spec 005).
- Funções de extensão do N8N nas expressões, quando os workflows da POC indicarem quais são usadas.
- Destaque de sintaxe no campo de expressão.
- Validação estrutural em tempo real no editor.

## Correções após o relatório

| Data | Defeito | Correção | Teste |
|---|---|---|---|
| 03/10/2026 | Teste de UX: a execução de teste rodava o fluxo inteiro; faltava executar um nó por vez, como no N8N | Spec e plano atualizados (HU-2.2, HU-2.4, FR-020, T036). Botão de executar no nó (canvas) e "Executar este nó" no painel. O editor envia `reuse` (nó → execução) com os anteriores que têm dados completos e não mudaram; a API lê os dados gravados e o motor os reaproveita (`runData`), registrando `node_executions.reused` (migration `0004_node_reused`). `data.setVariable` roda de novo (`rerunOnPartialExecution`) para manter `$vars`. Os dados dos nós posteriores somem da tela | Ver FR-020 em "Requisitos" |
| 03/10/2026 | "Definir variável" e "Se (If)" apareciam com o ícone genérico no canvas e na paleta | Ícones `variable` e `git-branch` no mapa do editor (`apps/web/src/editor/node-icons.ts`) | `apps/web/src/editor/graph.test.ts` › "todo nó da plataforma tem ícone próprio no editor" |
