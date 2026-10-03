# Sprint 1 — Editor visual e CRUD de workflows

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também `docs/relatorios/sprint-00.md`.

## Pré-requisitos

- Sprint 0 concluída e todos os comandos da seção 8 do contexto global passando.

## Contexto

O usuário precisa montar workflows arrastando nós em um canvas, como no N8N. Os parâmetros de cada nó são editados em um painel lateral gerado automaticamente a partir do `paramsSchema`. O acesso é controlado por papéis dentro de **projetos**.

## Objetivo

Criar, editar, salvar e reabrir workflows no canvas, com RBAC aplicado por projeto, e ter o primeiro esqueleto do motor executando `Manual → Set` em teste unitário.

## Tarefas

### T1 — Migrations
- Tabelas `workflows`, `workflow_versions` e `webhooks`, conforme a seção 10 da análise.
- `workflow_versions.definition` (JSONB) guarda o `WorkflowDefinition` completo.
- Salvar sempre cria uma nova versão (rascunho). `workflows.published_version` continua nulo até a Sprint 4.

### T2 — RBAC com CASL
- `AbilityFactory` monta as permissões efetivas do usuário:
  - **Admin global** (grupo `admin` do IdP): todas as permissões em todos os projetos.
  - **Demais usuários:** permissões do papel em `project_members`, válidas **somente** no projeto correspondente.
  - Usuário sem vínculo com o projeto não vê o projeto nem seus workflows (responda 404, não 403, para não revelar a existência).
- Decorator `@RequirePermission('workflow:update')` + guard que resolve o projeto a partir do recurso (workflow → projeto).
- **Teste de cobertura RBAC:** percorre todas as rotas registradas no NestJS e falha se alguma rota não for `@Public()` nem tiver `@RequirePermission`.
- `GET /api/v1/me` passa a retornar as permissões por projeto.

### T3 — API de projetos, membros e usuários
- CRUD de projetos (`project:manage`) e gestão de membros com papel (`project:manage`).
- Listagem de usuários para adicionar como membro (`user:manage` ou `project:manage`).
- Toda alteração gera um registro em `audit_log` (ação, entidade, usuário, IP, detalhes).

### T4 — API de workflows
- `POST /projects/:id/workflows`, `GET /workflows/:id`, `GET /projects/:id/workflows` (paginado), `PUT /workflows/:id` (salva uma nova versão), `DELETE /workflows/:id` (*soft delete*), `GET /workflows/:id/versions`.
- Valide o corpo com o schema zod de `WorkflowDefinition` e com a **validação estrutural** (T7).
- Controle de concorrência otimista: o `PUT` recebe `baseVersion`. Se for diferente da última versão, retorne 409.

### T5 — Registro de nós exposto
- `GET /api/v1/node-types` retorna `NodeRegistry.list()` (metadados, portas e `paramsSchema`).

### T6 — Motor de execução (esqueleto) — `packages/engine`
- `ExecutionState`: controla as entradas pendentes por nó/porta e os nós prontos.
- `runWorkflow(definition, triggerItems, ctx)`: execução **sequencial** em ordem topológica, propagando `NodeOutput` pelas arestas (porta de saída → porta de entrada).
- Nós com `disabled: true` repassam a entrada sem executar (comportamento do N8N).
- Callbacks de ciclo de vida (`onNodeStart`, `onNodeSuccess`, `onNodeError`) para log e WebSocket nas próximas sprints.
- **Sem** paralelismo, loops ou expressões nesta sprint.

### T7 — Validação estrutural do workflow (`packages/engine/validate.ts`)
- Rejeita:
  - arestas para nós ou portas inexistentes;
  - nomes de nó duplicados;
  - mais de um gatilho conectado ao mesmo nó de entrada;
  - **ciclos** (a exceção para o While chega na Sprint 6).
- Avisa (sem bloquear) sobre nós órfãos.
- Retorna uma lista de erros e avisos com `nodeId`, para destacar no canvas.

### T8 — Nós iniciais
- `trigger.manual`: sem parâmetros; emite os itens recebidos ou `[{ json: {} }]`.
- `data.set`: parâmetros `fields: [{ name, type: string|number|boolean|json, value }]` e `keepOnlySet: boolean`. Valores **fixos** nesta sprint (as expressões chegam na Sprint 2). Suporte notação de ponto em `name` (`cliente.nome` cria um objeto aninhado), como no N8N.

### T9 — Canvas (`apps/web`)
- Página `/workflows/:id` com `@xyflow/react`: adicionar nós pela paleta, mover, conectar portas, remover nó/aresta, zoom, *fit view* e minimapa.
- Componente de nó com ícone, nome, portas nomeadas (ex.: `true`/`false`) e indicador de erro de validação.
- **Paleta:** busca por nome e agrupamento por categoria, vindos de `GET /node-types`.
- **Desfazer/refazer** (Ctrl+Z / Ctrl+Shift+Z), copiar/colar nós (Ctrl+C / Ctrl+V, gerando novos ids e nomes únicos), excluir com Delete e salvar com Ctrl+S.
- Indicador de "alterações não salvas" e tratamento do 409 (oferecer recarregar).
- Estado do editor em Zustand.

### T10 — Painel de parâmetros
- Abrir com duplo clique no nó. Gera o formulário a partir do `paramsSchema`: string, number, boolean, enum (select), array de objetos (lista editável), objeto aninhado e campo de código/JSON (Monaco).
- Suporte `x-display-options` no schema para mostrar/ocultar campos conforme outro campo (equivalente ao `displayOptions` do N8N). Documente a convenção em `docs/nos/README.md`.
- Renomear o nó no painel, garantindo nome único.

### T11 — Telas de listagem e administração
- `/workflows`: lista por projeto, criar, renomear e excluir, respeitando as permissões (botões ocultos quando o usuário não tem permissão).
- `/admin`: projetos, membros e papéis (somente para quem tem `project:manage`).
- **Modo somente leitura** do canvas para quem só tem `workflow:read`.

## Fora do escopo

Expressões, execução pela UI, credenciais, nós de integração e publicação de workflows.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Criar `Manual → Set`, salvar, recarregar a página e ver o mesmo layout e parâmetros | E2E `editor.spec.ts` |
| 2 | `viewer@olly.local` abre o workflow em modo somente leitura; `PUT /workflows/:id` retorna 403 | E2E + integração |
| 3 | Usuário fora do projeto recebe 404 ao acessar workflow do projeto | Integração |
| 4 | Teste de cobertura RBAC verde (nenhuma rota sem permissão) | `rbac-coverage.test.ts` |
| 5 | `runWorkflow` executa `Manual → Set` e retorna os itens esperados, incluindo campo aninhado via notação de ponto | Unitário no `engine` |
| 6 | Workflow com ciclo é rejeitado com erro apontando os nós | Unitário + integração |
| 7 | Salvamento concorrente retorna 409 | Integração |
| 8 | Ações de criar/editar/excluir aparecem em `audit_log` | Integração |

## Entrega

Código, `docs/nos/trigger.manual.md`, `docs/nos/data.set.md`, `docs/nos/README.md` e o relatório `docs/relatorios/sprint-01.md`.
