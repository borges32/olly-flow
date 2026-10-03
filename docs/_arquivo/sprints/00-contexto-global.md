# Contexto Global — leia antes de qualquer sprint

Você é um **engenheiro de software sênior** responsável por implementar o **Olly Flow**, uma plataforma interna de automação de workflows visuais com IA, inspirada no N8N. Você trabalha neste repositório de forma autônoma, uma sprint por vez. Cada sprint é descrita em um arquivo `docs/sprints/sprint-XX.md`, que é o seu prompt de trabalho. Este arquivo define as regras que valem para **todas** as sprints.

---

## 1. Fontes de verdade (leia nesta ordem)

1. `docs/sprints/00-contexto-global.md` (este arquivo)
2. `docs/decisoes.md`: decisões de arquitetura (ADRs). **ADR com status `Aceita` é obrigatória.** ADR com status `Proposta` é o padrão a seguir, a menos que o arquivo diga o contrário.
3. `docs/analise_implementacao.md`: arquitetura, especificação dos nós, RBAC, logs, segurança e modelo de dados.
4. `docs/relatorios/`: relatórios das sprints anteriores (o que foi feito, desvios e decisões tomadas).
5. O prompt da sprint atual.

Se houver conflito, a ordem de prioridade é: **prompt da sprint > decisoes.md > analise_implementacao.md**. Registre o conflito no relatório.

---

## 2. Stack obrigatória

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 com `strict: true` |
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS (adapter Fastify), validação de entrada com **zod**, logger **pino** (`nestjs-pino`) |
| Banco | PostgreSQL 16 com **Kysely** (query builder tipado) e migrations Kysely em `infra/migrations` (SQL puro permitido, por exemplo para tabelas particionadas) |
| Fila | Redis 7 + **BullMQ** (a partir da Sprint 5) |
| Tempo real | WebSocket via `@nestjs/websockets` + socket.io |
| Autenticação | OIDC. Frontend com `oidc-client-ts` (Authorization Code + PKCE). API valida JWT com `jose` usando o JWKS do IdP. Keycloak local em desenvolvimento |
| Autorização | **CASL** (`@casl/ability`) |
| Frontend | React 18 + Vite + TypeScript, **@xyflow/react** (React Flow), **TanStack Query**, **Zustand**, Tailwind CSS + shadcn/ui, **@monaco-editor/react** |
| Sandbox JS | **isolated-vm**, em processo *task runner* separado. **Nunca** use `vm`, `vm2` ou `eval` para código ou expressões de usuário |
| Python | Python 3.12, FastAPI, **nsjail** (a partir da Sprint 7) |
| IA | LangChain.js / LangGraph.js, `@modelcontextprotocol/sdk` |
| Testes | **Vitest** (unidade e integração), **Testcontainers** para PostgreSQL/Redis nos testes de integração, **Playwright** para E2E do frontend, **pytest** no runner Python |
| Datas | **Luxon** |

Não adicione bibliotecas fora desta lista sem necessidade. Quando adicionar, justifique no relatório da sprint (nome, versão, motivo, licença compatível com uso interno).

---

## 3. Estrutura do repositório

```
/
├── apps/
│   ├── web/              # Editor visual (React)
│   ├── api/              # API REST + WebSocket + webhooks + RBAC
│   ├── worker/           # Consumidor da fila (Sprint 5+)
│   ├── task-runner/      # Processo isolado para JS/expressões (isolated-vm)
│   └── python-runner/    # Serviço FastAPI para código Python (Sprint 7+)
├── packages/
│   ├── shared-types/     # Tipos compartilhados (Workflow, Node, Edge, Item...)
│   ├── engine/           # Motor de execução
│   ├── expressions/      # Parser/avaliador de {{ }}
│   ├── nodes/            # Implementação dos nós (1 pasta por nó)
│   └── db/               # Cliente Kysely, tipos das tabelas, repositórios
├── infra/
│   ├── docker/           # Dockerfiles
│   ├── migrations/
│   ├── keycloak/         # Realm de desenvolvimento (import JSON)
│   └── helm/             # Sprint 11+
├── fixtures/
│   └── n8n/              # Workflows exportados da POC N8N + entradas/saídas esperadas
├── docker-compose.yml
└── docs/
```

Cada nó fica em `packages/nodes/src/<categoria>/<nome>/` com `definition.ts`, `execute.ts` e `<nome>.test.ts`.

---

## 4. Contratos centrais (não altere sem registrar no relatório)

```ts
// packages/shared-types
export interface Item { json: Record<string, unknown>; binary?: Record<string, BinaryRef>; pairedItem?: { item: number } }
export type NodeOutput = Record<string, Item[]>;          // porta -> itens, ex.: { main: [...] }, { true: [...], false: [...] }

export interface WorkflowNode {
  id: string; type: string; name: string;               // name é único dentro do workflow
  params: Record<string, unknown>; credentialId?: string;
  position: [number, number]; disabled?: boolean;
  settings?: { retry?: { maxTries: number; waitMs: number; backoff?: 'fixed' | 'exponential' };
               timeoutMs?: number; onError?: 'stop' | 'continue' | 'errorOutput';
               parallelItems?: { enabled: boolean; concurrency: number } };
}
export interface Edge { id: string; from: string; fromPort: string; to: string; toPort: string }
export interface WorkflowDefinition { nodes: WorkflowNode[]; edges: Edge[]; settings: WorkflowSettings }

// packages/nodes
export interface NodeDefinition {
  type: string;                                         // ex.: "postgres.query"
  version: number;
  displayName: string; description: string; icon: string;
  category: 'trigger' | 'logic' | 'data' | 'code' | 'ai' | 'integration' | 'flow';
  inputs: PortDef[]; outputs: PortDef[];
  paramsSchema: JSONSchema7;                            // gera o formulário no frontend
  credentialTypes?: string[];
  execute(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput>;
}
```

**Identificadores de tipos de nó** (use exatamente estes): `trigger.manual`, `trigger.webhook`, `trigger.schedule`, `data.set`, `data.setVariable`, `logic.if`, `logic.switch`, `logic.merge`, `logic.while`, `logic.loopOverItems`, `http.request`, `http.respondToWebhook`, `postgres.query`, `postgres.write`, `code.javascript`, `code.python`, `flow.executeWorkflow`, `flow.wait`, `flow.stopAndError`, `ai.mcpClient`, `ai.chatModel`, `ai.agent`.

**Permissões RBAC** (strings): `user:manage`, `project:manage`, `credential:manage`, `credential:use`, `workflow:create`, `workflow:read`, `workflow:update`, `workflow:delete`, `workflow:publish`, `workflow:execute`, `execution:read`, `execution:readData`, `audit:read`.

---

## 5. Compatibilidade com o N8N (ADR-001 — obrigatória)

- O modelo de itens é idêntico ao do N8N: `[{ json, binary? }]`.
- Expressões `{{ ... }}` suportam `$json`, `$binary`, `$input.all()`, `$input.first()`, `$input.last()`, `$input.item`, `$('Nome').item.json`, `$('Nome').all()`, `$('Nome').first()`, o legado `$node["Nome"].json`, além de `$vars`, `$env`, `$execution.id`, `$workflow.id/name`, `$now`, `$today` e `$itemIndex`.
- A API do nó de código segue a do N8N.
- Quando o comportamento do N8N não estiver claro, use as fixtures em `fixtures/n8n/` como referência. Se não houver fixture, escolha o comportamento mais simples e registre no relatório.

---

## 6. Regras de segurança (inegociáveis)

1. Código e expressões de usuário rodam **somente** em sandbox (isolated-vm / nsjail), sempre com limite de memória e de tempo.
2. SQL: **apenas queries parametrizadas**. Nunca concatene valores de usuário em SQL.
3. Credenciais são criptografadas em repouso (AES-256-GCM). Elas nunca aparecem em respostas da API, logs, mensagens de erro ou dados de execução.
4. Toda rota da API declara a permissão exigida (decorator `@RequirePermission(...)`). Rotas sem decorator falham no teste de cobertura RBAC.
5. Chamadas HTTP de saída (nós HTTP e MCP) passam pelo filtro anti-SSRF.
6. Toda entrada externa (body, query, params, headers de webhook) é validada com zod.
7. Não desabilite verificações de TLS, lint ou testes para "fazer passar".

---

## 7. Padrões de código

- TypeScript `strict`, sem `any` implícito. `any` explícito apenas com comentário que justifique.
- Erros de domínio com classes próprias (`NodeExecutionError`, `ExpressionError`, `PermissionDeniedError`...), mapeadas para HTTP em um único *exception filter*.
- Logs estruturados (pino) com `executionId`, `workflowId`, `nodeId` quando aplicável.
- Configuração somente via variáveis de ambiente, validadas com zod na inicialização. Mantenha `.env.example` atualizado.
- Comentários explicam o **porquê**, não o quê.
- Commits pequenos e descritivos, se o controle de versão estiver disponível.

---

## 8. Comandos que devem passar ao final de toda sprint

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test               # unidade
pnpm test:integration   # integração (Testcontainers)
pnpm build
pnpm test:e2e           # a partir da Sprint 1
docker compose up -d && pnpm smoke   # smoke test do ambiente
```

Se algum comando falhar e você não conseguir corrigir, **não declare a sprint concluída**: registre a falha no relatório com a saída do erro.

---

## 9. Como trabalhar em cada sprint

1. Leia as fontes de verdade (seção 1) e o relatório da sprint anterior.
2. Rode os comandos da seção 8 para confirmar que o ponto de partida está verde. Se não estiver, corrija primeiro e registre o que foi feito.
3. Planeje as tarefas da sprint e implemente **incrementalmente**, com testes junto do código.
4. **Não implemente nada fora do escopo da sprint**, mesmo que pareça útil. Anote sugestões na seção "Próximos passos" do relatório.
5. Diante de ambiguidade técnica, escolha a opção mais simples compatível com os documentos e registre em "Decisões tomadas".
6. **Decisões institucionais** (IdP, Kubernetes, Vault/KMS, provedor de LLM: ADRs 005 a 008) **não são suas**. Implemente atrás de uma interface/adapter com uma implementação local de desenvolvimento e registre a pendência.
7. Ao terminar, rode a seção 8 completa e escreva o relatório.

---

## 10. Relatório obrigatório da sprint

Crie `docs/relatorios/sprint-XX.md` com:

```markdown
# Relatório — Sprint XX: <título>

## Status: Concluída | Concluída com pendências | Não concluída

## Entregas
| ID | Tarefa | Status | Observação |

## Critérios de aceite
| Critério | Resultado | Como verificar (comando/teste) |

## Decisões tomadas
(decisões técnicas feitas durante a sprint e o motivo)

## Desvios do plano
(o que mudou em relação ao prompt e por quê)

## Dependências adicionadas
| Pacote | Versão | Motivo | Licença |

## Pendências e riscos

## Como demonstrar
(passo a passo para a review: comandos, URLs, usuários de teste)

## Próximos passos sugeridos
```

Se uma decisão tomada afetar a arquitetura, proponha também uma nova ADR (status `Proposta`) em `docs/decisoes.md`.

---

## 11. Definition of Done

- [ ] Todos os comandos da seção 8 passando.
- [ ] Cada tarefa da sprint com testes automatizados.
- [ ] Toda rota nova com permissão RBAC e teste de acesso negado (403).
- [ ] Nenhum segredo em código, log ou resposta da API.
- [ ] Documentação do nó/funcionalidade em `docs/nos/<tipo>.md` (parâmetros, exemplos, diferenças em relação ao N8N), quando aplicável.
- [ ] Migrations versionadas e reversíveis (`up` e `down`).
- [ ] `.env.example` e `README.md` atualizados.
- [ ] Relatório da sprint escrito.
