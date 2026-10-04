# Plano técnico — Spec 002: Editor visual, workflows e RBAC por projeto

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

Três frentes:
- **RBAC:** CASL com permissões por projeto, aplicado por guard e decorator, mais um teste que varre todas as rotas.
- **API e engine:** CRUD de workflows com versionamento e concorrência otimista; validação estrutural e motor sequencial no `packages/engine`.
- **Editor:** canvas com `@xyflow/react`, estado em Zustand e painel gerado por JSON Schema.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| II — N8N | Nó desabilitado repassa a entrada; `data.set` com notação de ponto, como no N8N |
| III — Segurança | Guard + decorator obrigatório + teste de cobertura; 404 para recursos de outros projetos |
| VII — Rastreabilidade | Auditoria de projetos, membros e workflows |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/db` | Migrations de `workflows`, `workflow_versions` e `webhooks` |
| `apps/api` | Módulos `rbac`, `projects`, `workflows` e `node-types` |
| `packages/engine` | `ExecutionState`, `runWorkflow` sequencial, `validate.ts` |
| `packages/nodes` | `trigger.manual`, `data.set` |
| `apps/web` | Canvas, paleta, painel de parâmetros, listagem, administração |

## Design

### §1 RBAC (CASL)
- **`AbilityFactory.forUser(user)`:**
  - membro do grupo de administração do IdP (`OIDC_ADMIN_GROUP`, padrão `admin`): `can('manage', 'all')`;
  - demais usuários: para cada `project_members`, as permissões do papel com a condição `{ projectId }`.
- `@RequirePermission('workflow:update', { workflow: 'id' })` + `PermissionGuard`. O segundo argumento é o escopo: `{ project: param }`, `{ workflow: param }`, `'global'` ou `'anyProject'`. Um `ResourceResolver` resolve o `projectId` a partir do parâmetro (workflow → projeto, credencial → projeto...). `@RequireProjectMember(param)` exige só ser membro; `@Authenticated()` (spec 001) declara rotas que exigem apenas login.
- **Recurso de outro projeto:** quando o usuário não é membro, o guard lança `NotFoundException`.
- **Teste de cobertura:** usa `DiscoveryService` do NestJS para listar todas as rotas e falha se alguma não tiver `@Public`, `@Authenticated` ou `@RequirePermission`/`@RequireProjectMember`.
- Substitui o `PermissionResolver` da spec 001. `/me` passa a retornar `permissions: { global: [...], projects: { [id]: [...] } }`, mantendo `id`, `email` e `name`.

### §2 API

| Método | Rota | Permissão | Observação |
|---|---|---|---|
| POST/GET/PUT/DELETE | `/projects[/:id]` | `project:manage` (GET: membro) | `GET /projects` lista os projetos do usuário (todos, para o administrador global). `DELETE` responde 409 se o projeto tiver workflows |
| GET/PUT/DELETE | `/projects/:id/members[/:userId]` | `project:manage` | |
| GET | `/users?search=` | `user:manage` ou `project:manage` | |
| POST | `/projects/:id/workflows` | `workflow:create` | |
| GET | `/projects/:id/workflows` | `workflow:read` | Paginado |
| GET | `/workflows/:id` | `workflow:read` | Última versão |
| PUT | `/workflows/:id` | `workflow:update` | Corpo `{ name?, definition, baseVersion }`; 409 se `baseVersion` ≠ última |
| DELETE | `/workflows/:id` | `workflow:delete` | Soft delete (`deleted_at`) |
| GET | `/workflows/:id/versions` | `workflow:read` | |
| GET | `/node-types` | Autenticado | `NodeRegistry.list()` |

Todas as mutações geram registro em `audit_log` (`AuditService.record(action, entity, details)`).

### §3 Validação estrutural (`packages/engine/validate.ts`)
- Retorna `{ errors: Issue[], warnings: Issue[] }` com `Issue = { code, message, nodeIds[] }`.
- **Erros:** `EDGE_UNKNOWN_NODE`, `EDGE_UNKNOWN_PORT`, `DUPLICATE_NODE_NAME`, `CYCLE` (via Tarjan/DFS, listando os nós do ciclo), além de `NODE_UNKNOWN_TYPE` e `DUPLICATE_NODE_ID` (sem eles não há como validar portas).
- **Avisos:** `ORPHAN_NODE`.
- A API rejeita com 422 se houver erros. Corpo fora do schema zod (forma do JSON) responde 400 com o caminho do campo.

### §4 Motor sequencial
- **`ExecutionState`:** mapa `nodeId → { inputs: Record<port, Item[]>, status }` e cálculo de prontidão.
- **`runWorkflow(def, triggerItems, ctx)`:** ordenação topológica e execução nó a nó. A saída de cada porta é entregue às arestas correspondentes.
- Nó `disabled` copia a primeira entrada para a saída `main`.
- **Callbacks:** `onNodeStart`, `onNodeSuccess`, `onNodeError`, `onExecutionFinish`.

### §5 Nós
- **`trigger.manual`:** sem parâmetros. Emite os `triggerItems` ou `[{ json: {} }]`.
- **`data.set`:**
  - parâmetros `fields: [{ name, type: 'string'|'number'|'boolean'|'json', value }]` e `keepOnlySet` (padrão `false`);
  - conversão de tipo com erro claro;
  - notação de ponto via `lodash/set`;
  - `pairedItem` preenchido.

### §6 Canvas (`apps/web`)
- Rota `/workflows/:id`. Store Zustand com `nodes`, `edges`, `history` (pilha de desfazer/refazer limitada a 100), `dirty` e `baseVersion`.
- Componentes `WorkflowNode` (ícone, nome, portas nomeadas, badge de erro) e `NodePalette` (busca + categorias).
- **Atalhos:** Ctrl+Z, Ctrl+Shift+Z, Ctrl+C, Ctrl+V, Delete e Ctrl+S.
- 409 abre um diálogo "recarregar versão mais recente".

### §7 Painel de parâmetros
- Renderizador próprio de JSON Schema: string, number, boolean, enum, array de objetos e objeto. O `x-widget: code|json` (Monaco) fica para a primeira spec com um nó que o use (ver Histórico).
- **`x-display-options`:** `{ show?: { campo: [valores] }, hide?: {...} }`, equivalente ao `displayOptions` do N8N. Documentado em `docs/nos/README.md`.
- Renomear o nó com validação de unicidade.

### §8 Listagem e administração
- `/workflows`: seletor de projeto e ações condicionadas às permissões.
- `/admin`: projetos, membros e papéis.
- `useCan(permission, projectId)` para condicionar a UI.

## Modelo de dados

`workflows`, `workflow_versions` e `webhooks` (estrutura; uso na spec 005), conforme [modelo-dados.md](../../docs/arquitetura/modelo-dados.md). `workflows.version` guarda a última versão: o salvamento faz `UPDATE ... WHERE version = baseVersion`, e nenhuma linha afetada significa 409.

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Renderizador de formulário próprio | RJSF | Controle do alternador Fixo/Expressão (spec 003) e de `x-display-options` |
| 404 para outros projetos | 403 | Não revelar a existência de recursos |
| Versão por salvamento | Versão só na publicação | Histórico completo e base para o diff (spec 009) |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001, FR-002, FR-003 | Integração | `workflows.int.test.ts` |
| FR-004, FR-005 | Unidade + integração | `validate.test.ts` |
| FR-010, FR-011, FR-015 | Integração + E2E | `rbac.int.test.ts`, `readonly.spec.ts` |
| FR-012 | Unidade | `rbac-coverage.test.ts` |
| FR-014 | Integração | `audit.int.test.ts` |
| FR-007, FR-008, FR-009 | E2E | `editor.spec.ts` |
| FR-016, FR-017, FR-018 | Unidade | `engine.test.ts`, `data.set.test.ts` |

## Riscos

| Risco | Mitigação |
|---|---|
| Desempenho do canvas com muitos nós | Memoização dos componentes de nó; teste com 100 nós |
| Complexidade do renderizador de formulários | Suportar só o subconjunto de JSON Schema usado pelos nós |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | `x-widget: code|json` (Monaco) adiado para a spec do primeiro nó que o use (003 ou 005) | Nenhum nó da spec 002 usa o widget; constituição, Art. IX.2 (sem abstrações para uso futuro) |
| 03/10/2026 | Grupo de administração global configurável (`OIDC_ADMIN_GROUP`) | O nome do grupo institucional depende da ADR-0005 (Art. VI) |
| 03/10/2026 | Escopo explícito no `@RequirePermission`, `@RequireProjectMember` e `@Authenticated` aceitos na cobertura | Rotas sem permissão específica (`/me`, `/node-types`, `GET /projects`) precisam de declaração explícita (Art. III.4) |
| 03/10/2026 | Erros `NODE_UNKNOWN_TYPE` e `DUPLICATE_NODE_ID`; 400 para corpo malformado | Pré-condições da validação de portas e da identificação dos nós |
| 03/10/2026 | `DELETE /projects/:id` com workflows responde 409; coluna `workflows.version` | Preservar o histórico de versões; concorrência otimista atômica |
