# Stack e Estrutura do Repositório

> Normativo (constituição, Artigo IX). Alterações exigem ADR.

## Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 com `strict: true` |
| Monorepo | pnpm workspaces + Turborepo |
| API | NestJS (adapter Fastify), validação com **zod**, logger **pino** (`nestjs-pino`) |
| Banco | PostgreSQL 16 com **Kysely** e migrations Kysely em `infra/migrations` (SQL puro permitido, por exemplo para partições) |
| Fila | Redis 7 + **BullMQ** (a partir da spec 006) |
| Tempo real | `@nestjs/websockets` + socket.io |
| Autenticação | OIDC. Frontend com `oidc-client-ts` (Authorization Code + PKCE). API valida JWT com `jose` via JWKS. Keycloak local em desenvolvimento |
| Autorização | **CASL** (`@casl/ability`) |
| Frontend | React 18 + Vite + TypeScript, **@xyflow/react**, **TanStack Query**, **Zustand**, Tailwind CSS + shadcn/ui, **@monaco-editor/react**, React Router |
| Sandbox JS | **isolated-vm** em processo *task runner* separado. **Proibido:** `vm`, `vm2` e `eval` para conteúdo de usuário |
| Python | Python 3.12, FastAPI, `uv`, **nsjail** (spec 008) |
| IA | LangChain.js / LangGraph.js, `@modelcontextprotocol/sdk` |
| Object storage | MinIO (dev) / S3 compatível |
| Testes | **Vitest**, **Testcontainers**, **Playwright**, **pytest**, **k6** (carga) |
| Datas | **Luxon** |
| Observabilidade | OpenTelemetry, Prometheus, Grafana, Tempo, Loki (spec 012) |

## Estrutura do repositório

```
/
├── AGENTS.md / CLAUDE.md    # entrada para agentes de IA
├── .specify/
│   ├── memory/constitution.md
│   └── templates/           # spec, plan, tasks, report
├── specs/                   # uma pasta por spec (spec.md, plan.md, tasks.md, report.md)
├── apps/
│   ├── web/                 # Editor visual (React)
│   ├── api/                 # API REST + WebSocket + webhooks + RBAC
│   ├── worker/              # Consumidor da fila (spec 006+)
│   ├── task-runner/         # Processo isolado para JS/expressões (isolated-vm)
│   └── python-runner/       # Serviço FastAPI para Python (spec 008+)
├── packages/
│   ├── shared-types/        # Tipos e schemas zod compartilhados
│   ├── engine/              # Motor de execução
│   ├── expressions/         # Parser/avaliador de {{ }}
│   ├── nodes/               # Nós: src/<categoria>/<nome>/{definition,execute,*.test}.ts
│   ├── db/                  # Kysely, tipos das tabelas, repositórios
│   ├── mcp-client/          # spec 010
│   └── importer-n8n/        # spec 012
├── infra/
│   ├── docker/  migrations/  keycloak/  helm/  grafana/  load/  mcp-test-server/
├── fixtures/
│   ├── n8n/                 # Workflows da POC: workflow.json, input.json, expected.json, notes.md
│   └── olly/                # Equivalentes no formato Olly Flow
├── security/sandbox/        # Bateria de testes de escape (spec 008)
├── docker-compose.yml
└── docs/
    ├── produto/  arquitetura/  adr/  roadmap.md
    ├── nos/                 # Documentação por nó (gerada pelas specs)
    ├── estudos/             # Análise original (não normativa)
    └── _arquivo/            # Documentos substituídos (não usar)
```

## Convenções de código

- TypeScript `strict`, sem `any` implícito. `any` explícito apenas com comentário que justifique.
- Erros de domínio com classes próprias (`NodeExecutionError`, `ExpressionError`, `PermissionDeniedError`...), mapeadas para HTTP em um único *exception filter*.
- Logs estruturados (pino) com `executionId`, `workflowId` e `nodeId` quando aplicável.
- Configuração somente via variáveis de ambiente, validadas com zod na inicialização. Mantenha o `.env.example` atualizado.
- Prefixo de rotas `/api/v1`, exceto `/health`, `/metrics`, `/webhook` e `/webhook-test`.
- Comentários explicam o **porquê**, não o quê.
- Testes citam o requisito: `it('FR-003: rejeita expressão no campo query', ...)`.
