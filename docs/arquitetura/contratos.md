# Contratos Centrais

> Normativo. Alterações exigem registro no `plan.md` da spec e no `report.md` (constituição, Artigo IX.3). Ao alterar, atualize este arquivo.

## Tipos de workflow (`packages/shared-types`)

```ts
export interface BinaryRef { id: string; mimeType: string; fileName?: string; size?: number }
export interface Item {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryRef>;            // referência a objeto no storage
  pairedItem?: { item: number; input?: number }; // item de entrada que originou este
}
export type NodeOutput = Record<string, Item[]>; // porta -> itens: { main }, { true, false }, { output0.. }, { error }

export interface WorkflowNode {
  id: string;
  type: string;                                   // ver "Tipos de nó"
  name: string;                                   // único no workflow; usado em $('Nome')
  params: Record<string, unknown>;
  credentialId?: string;
  position: [number, number];
  disabled?: boolean;
  settings?: {
    retry?: { maxTries: number; waitMs: number; backoff?: 'fixed' | 'exponential' };
    timeoutMs?: number;
    onError?: 'stop' | 'continue' | 'errorOutput';
    parallelItems?: { enabled: boolean; concurrency: number };
  };
}
export interface Edge { id: string; from: string; fromPort: string; to: string; toPort: string }
export interface PortDef {
  name: string; displayName?: string; required?: boolean;
  kind: 'main' | 'ai_languageModel' | 'ai_memory' | 'ai_tool';
}
export type ExecutionStatus = 'queued' | 'running' | 'waiting' | 'success' | 'error' | 'cancelled';
export type NodeExecutionStatus = 'running' | 'success' | 'error' | 'skipped' | 'waiting' | 'cancelled';

export interface WorkflowSettings {
  timeoutSec?: number;
  maxParallel?: number;                           // padrão 8 (spec 006)
  saveExecutionData?: 'all' | 'errorsOnly' | 'none'; // spec 009
  errorWorkflowId?: string;                       // spec 007
}
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: Edge[];
  settings: WorkflowSettings;
  pinData?: Record<string, Item[]>;               // por id do nó (spec 003)
}
```

`workflowDefinitionSchema` (zod) valida também: ids e nomes de nó únicos, ids de aresta únicos e arestas/`pinData` apontando para nós existentes.

## Contrato de nó (`packages/nodes`)

```ts
export interface NodeDefinition {
  type: string;
  version: number;
  displayName: string;
  description: string;
  icon: string;
  category: 'trigger' | 'logic' | 'data' | 'code' | 'ai' | 'integration' | 'flow';
  inputs: PortDef[];
  outputs: PortDef[];                             // podem ser dinâmicas (Merge, Switch)
  paramsSchema: JSONSchema7;                      // gera o formulário; extensões x-display-options, x-secret
  credentialTypes?: string[];
  supportsParallelItems?: boolean;                // spec 006
  execute(input: NodeExecuteInput, ctx: NodeContext): Promise<NodeOutput>;
}
```

`NodeContext` oferece, entre outros: `getParam(name, itemIndex)` (com expressões resolvidas), `getCredential()`, `signal` (`AbortSignal`), `logger` e `helpers` (paired items, binários). `NodeExecuteInput` traz `inputs` (itens por porta) e `items` (atalho para `inputs.main`).

`NodeRegistry` (`register`, `get(type, version?)`, `list()` sem `execute`) recusa nós cujo `paramsSchema` não seja um JSON Schema draft-07 válido com `type: "object"` na raiz. Palavras-chave desconhecidas são erro; as extensões aceitas são `x-display-options` e `x-secret`.

## Tipos de nó

| Tipo | Spec | Tipo | Spec |
|---|---|---|---|
| `trigger.manual` | 002 | `http.request` | 004 |
| `trigger.webhook` | 005 | `http.respondToWebhook` | 005 |
| `trigger.schedule` | 008 | `postgres.query` | 004 |
| `trigger.error` | 007 | `postgres.write` | 004 |
| `trigger.executeWorkflow` | 008 | `code.javascript` | 005 |
| `data.set` | 002 | `code.python` | 008 |
| `data.setVariable` | 003 | `flow.executeWorkflow` | 008 |
| `logic.if` | 003 | `flow.wait` | 008 |
| `logic.switch` | 007 | `flow.stopAndError` | 008 |
| `logic.merge` | 007 | `ai.mcpClient` | 010 |
| `logic.while` | 007 | `ai.chatModel` | 011 |
| `logic.loopOverItems` | 007 | `ai.agent` | 011 |
| `placeholder.unsupported` | 012 | `tool.*`, `memory.*` (sub-nós) | 011 |

## Permissões RBAC

| Permissão | Introduzida na spec |
|---|---|
| `user:manage`, `project:manage` | 002 |
| `workflow:create`, `workflow:read`, `workflow:update`, `workflow:delete`, `workflow:execute` | 002 |
| `execution:read` | 003 |
| `credential:manage`, `credential:use` | 004 |
| `workflow:publish`, `execution:readData` | 005 |
| `audit:read` | 009 |
| `mcp:manage` | 010 |

Catálogo e papéis padrão em `packages/shared-types/src/rbac.ts` (seed da spec 001): `admin` tem todas; `editor`, todas exceto `user:manage`, `project:manage` e `audit:read`; `executor`, `workflow:read`, `workflow:execute` e `execution:read`; `viewer`, `workflow:read` e `execution:read`. `mcp:manage` entra no catálogo e no seed na spec 010.

Matriz por papel: [`docs/rbac-matriz.md`](../rbac-matriz.md), gerada pelo teste da spec 005.

## Convenção de expressões (spec 003)

- Um parâmetro string que começa com `=` é uma expressão-template: `"=Olá {{ $json.nome }}"`.
- Um template formado por um único `{{ }}` preserva o tipo do resultado. Um template misto produz string.
- Variáveis: `$json`, `$binary`, `$itemIndex`, `$input.*`, `$('Nó').item|all()|first()|last()|params`, `$node["Nó"]` (legado), `$vars`, `$env` (somente `OLLY_EXPOSED_*`), `$execution`, `$workflow`, `$now`, `$today`, `$loop` (spec 007), `$response` e `$pageCount` (paginação, spec 008), `$fromAI()` (tools, spec 011).

## Eventos WebSocket (namespace `/executions`, sala `execution:<id>`)

`executionStarted` · `nodeStarted` · `nodeFinished` (inclui `runIndex`) · `executionFinished` · `agentStep` (spec 011) · `testWebhookReceived` (spec 005).
