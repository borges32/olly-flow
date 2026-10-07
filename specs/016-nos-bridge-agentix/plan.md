# Plano técnico — Spec 016: Nós Bridge Chat Model e Agentix

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Dois tipos de credencial** (`bridgeApi` e `agentixApi`, os mesmos nomes do N8N) e **dois nós** em `packages/nodes`:
  - **`ai.bridgeChatModel`:** sub-nó com saída `ai_languageModel`. Usa o `ChatOpenAI` do LangChain com a URL base `<baseUrl>/deployments/{modelo}` e um `fetch` próprio, que injeta o token, remove o `model` do corpo e refaz o login em 401/403;
  - **`ai.agentix`:** nó principal que cria a sessão, consulta o estado no próprio nó (dormindo entre as consultas, interrompível pelo `ctx.signal`) e monta a saída.
- **Verificação TLS desligável por credencial**, sem desligar o anti-SSRF: o `HttpGuard` ganha a opção `insecureTls`, com um segundo agente HTTP que mantém o mesmo `lookup` validado.
- **Governança de IA** (spec 011) sem a lista de modelos: a Bridge pula `checkModel`, mas passa por `beforeModelCall` (limite mensal) e `recordUsage` (uso e custo).
- **Importador do N8N** (spec 015): conversores para os tipos `CUSTOM.*` e do pacote, e mapeamento das credenciais.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| I — Spec antes do código | Esclarecimentos do PO registrados no histórico da spec antes deste plano |
| II — Compatibilidade com o N8N | Mesmos parâmetros, credenciais e comportamento dos nós customizados; importação dos workflows da POC |
| III — Segurança | Toda chamada passa pelo anti-SSRF (também sem verificar TLS); senha, chave e token mascarados (`registerSecret`); sem endereços institucionais no código. **Exceção aceita pelo PO:** desligar a verificação do certificado por credencial (registrada em "Riscos") |
| IV — Testes | Serviços simulados (HTTP e HTTPS autoassinado) nos testes de unidade e integração; cada FR com teste que o cita |
| IX — Contratos | `docs/arquitetura/contratos.md` (tipos de nó, credenciais, opção do `HttpGuard`) atualizado |

## Componentes afetados

| Componente | Mudança |
|---|---|
| `packages/nodes` | Credenciais `bridgeApi` e `agentixApi`; nós `ai.bridgeChatModel` e `ai.agentix`; `insecureTls` no `HttpGuard`; teste da credencial Bridge; provedor `bridge` |
| `apps/api` | `AiGateway.fetchFor({ insecureTls })`; injeção do `HttpGuard` no Agentix; importador do N8N (conversores e tipos `CUSTOM.*`) |
| `apps/web` | Ícones dos nós novos (o painel e as credenciais vêm do schema) |
| `docs/` | `docs/nos/ai.bridgeChatModel.md`, `docs/nos/ai.agentix.md`, `docs/nos/workflow-json.md`, `docs/credenciais.md`, `docs/importacao-n8n.md`, contratos |

## Design

### §1 Credenciais (`packages/nodes/src/credentials/definitions.ts`)

| Tipo | Campos (todos sem valor padrão, exceto onde indicado) |
|---|---|
| `bridgeApi` ("IA: Bridge") | `tokenUrl` (login), `baseUrl`, `identificador`, `senha` (`x-secret`), `tokenSkewSeconds` (padrão 60, de 0 a 600), `allowUnauthorizedCerts` (padrão `false`) |
| `agentixApi` ("Agentix") | `baseUrl`, `apiKey` (`x-secret`), `allowUnauthorizedCerts` (padrão `false`) |

- **Testes da credencial (`testCredential`):** a Bridge faz o login (o mesmo do §3) e responde "Login bem-sucedido" ou o status com um trecho da resposta, sem a senha. O Agentix responde com `CredentialTestInputError` ("validada na primeira execução"), como no N8N, que não tem um endpoint só de validação.
- **Rótulo:** a descrição de `allowUnauthorizedCerts` avisa que a verificação do certificado fica desligada, enquanto o anti-SSRF continua valendo.

### §2 TLS desligável sem perder o anti-SSRF (`shared/http-guard.ts`)

- `GuardedRequestInit.insecureTls?: boolean`.
- O guard cria, sob demanda, um segundo `undici.Agent` com o mesmo `connect.lookup` validado e `rejectUnauthorized: false`. O `assertDestinationAllowed` e os redirects continuam iguais. O agente é fechado em `close()`.
- **API:** `AiGateway.fetchFor({ insecureTls })` devolve o `fetch` guardado (limite de resposta do modelo) com a opção. O `AiGateway.fetch` atual equivale a `fetchFor({ insecureTls: false })`.

### §3 Bridge Chat Model (`packages/nodes/src/ai/bridge/`)

- **`token-manager.ts`:**
  - **cache:** um `Map` em memória por processo, com a chave `credential.id + updatedAt` (uma credencial alterada invalida o token). Guarda `{ token, renewAt, pending? }`;
  - **renovação:** lê o `exp` do JWT sem verificar a assinatura. `renewAt = exp − margem`, ou `agora + 20 min − margem` se o `exp` não for legível;
  - **logins simultâneos:** compartilham a mesma promise (`pending`); uma falha limpa a entrada;
  - **login:** `POST tokenUrl { identificador, senha }`. Erro (status diferente de 2xx ou sem `token`) gera uma mensagem com o status e até 500 caracteres da resposta;
  - **mascaramento:** o token é registrado com `ctx.helpers.registerSecret` a cada obtenção.
- **`bridge-fetch.ts`:** o `fetch` entregue ao `ChatOpenAI`:
  1. tira o `model` do corpo JSON (salvo com `sendModelInBody`);
  2. põe `Authorization: Bearer <token>`;
  3. em 401/403, invalida o token, faz um novo login e repete uma vez.

  Usa `ai.fetchFor({ insecureTls })`, sempre pelo anti-SSRF.
- **Nó `ai.bridgeChatModel`** ("Bridge Chat Model", categoria `ai`, saída `ai_languageModel`, credencial `bridgeApi`):
  - **parâmetros:**
    - `model` (obrigatório, texto livre, sem `x-load-options`);
    - `stream` (padrão `true`);
    - `options`: `temperature` (0–2), `topP` (0–1), `maxTokens` (0 = padrão do modelo), `n` (≥ 1), `stop` (lista separada por vírgula), `user`, `timeoutMs` (padrão 360000), `maxRetries` (padrão 2), `streamUsage` (padrão `false`), `sendModelInBody` (padrão `false`);
  - **`supplyData`:** monta o `ChatOpenAI` com `baseURL = <baseUrl sem / final>/deployments/<encodeURIComponent(model)>`, `apiKey` fictícia (a autenticação é do `fetch`), `streaming`, `streamUsage`, os demais parâmetros e o `fetch` da Bridge. Os 401/403 não entram nas novas tentativas do SDK (o `fetch` já trata);
  - **retorno:** `ChatModelSupply` com `provider: 'bridge'` (novo valor de `ChatModelProvider`) e o nome do modelo. **Não** chama `ai.checkModel` (FR-006).
- **Agent (spec 011):** nada muda. `beforeModelCall` (limite mensal) e `recordUsage` (com `provider: 'bridge'`) já valem para qualquer modelo entregue. O custo usa a tabela de preços pelo nome do modelo e fica nulo se não houver preço.

### §4 Agentix (`packages/nodes/src/ai/agentix/`)

- **Nó `ai.agentix`** ("Agentix", categoria `ai`, entrada e saída `main`, credencial `agentixApi`, `supportsParallelItems: false`). Subtítulo: tipo e nome da entidade.
  - **Parâmetros:**
    - `entityType` (`agent` | `workflow`, padrão `agent`);
    - `entityName`, `entityVersion`, `bundle` e `bundleVersion` (obrigatórios);
    - `payload` e `constants` (texto JSON ou expressão que produz um objeto; padrões `{"pergunta": ""}` e `{}`);
    - `waitForCompletion` (padrão `true`);
    - `output` (`finalAnswer` | `allMessages`, visível com espera);
    - `options`: `pollIntervalSeconds` (padrão 3, mínimo 0,1), `timeoutSeconds` (padrão 600, 0 = sem limite próprio), `maxPollErrors` (padrão 3) e `includeSession` (padrão `false`), visíveis com espera.
  - **Execução por item, em sequência:**
    1. `POST {baseUrl}/sessions/invoke` com o corpo do FR-009 e `X-API-Key`. Sem `session_id`, erro;
    2. sem espera, devolve a resposta do `invoke`;
    3. **espera:** `GET sessions/{id}` até `DONE`. `FAILED`, `CANCELLED` e `REJECTED` geram erro com `error_message`; o tempo limite gera erro com o último estado. Erros de consulta seguidos acima de `maxPollErrors` repassam o erro. Entre as consultas, `sleep(intervalo, ctx.signal)` (FR-011: cancelamento, tempo do nó e do workflow);
    4. **mensagens:** `GET sessions/{id}/messages`, aceitando uma lista pura ou embrulhada em `messages` ou `items`;
    5. **saída:**
       - "resposta final": `{ session_id, state, output }`, com o conteúdo da última mensagem `assistant`;
       - "todas as mensagens": `{ session_id, state, messages }`;
       - com `includeSession`, acrescenta `session`.
  - **Chamadas:** pelo `HttpGuard` injetado (`createBuiltinNodes({ httpGuard })`), com `insecureTls` da credencial e `accept: application/json`. Uma resposta fora de 2xx gera erro com o método, o caminho, o status e um trecho do corpo, sem a chave.
  - **Tratamento de erro por item (FR-010):** o motor já aplica `settings.onError` por item, pelo `pairedItem` (como nos nós HTTP).
- **Worker (NFR-002):** o sono não ocupa CPU. No encerramento, o sinal das execuções em andamento é abortado pelo mecanismo atual da spec 006.

### §5 Importador do N8N (`apps/api/src/workflow-io/n8n/`)

- **Detecção:** o padrão de tipos do N8N passa a incluir `CUSTOM.`.
- **Conversores:**

  | Tipo do N8N | Nó do Olly Flow | Parâmetros |
  |---|---|---|
  | `CUSTOM.bridgeChatModel`, `n8n-nodes-bridge-chat-model.bridgeChatModel` | `ai.bridgeChatModel` | `model` e `stream`; `options.*`, com `maxTokens: -1` → 0 e `timeout` → `timeoutMs` |
  | `CUSTOM.agentix`, `n8n-nodes-bridge-chat-model.agentix` | `ai.agentix` | Mesmos nomes; `options.pollInterval` → `pollIntervalSeconds`, `options.timeout` → `timeoutSeconds`; `payload` e `constants` em objeto viram texto JSON |

- **Credenciais:** `bridgeApi` → `bridgeApi` e `agentixApi` → `agentixApi`.
- **Agentix como ferramenta:** o Agentix ligado por `ai_tool` (ou o tipo `…agentixTool`) vira marcador, com o motivo "uso como ferramenta fora do escopo (spec 016)".

### §6 Editor

Os ícones `bridge` e `agentix` entram em `node-icons.ts` (ícones lucide equivalentes: `Waypoints` e `Bot`). O painel de parâmetros e o formulário das credenciais são gerados dos schemas, sem tela nova.

## Modelo de dados

Sem migrations: os tipos de credencial são definições; os dados ficam cifrados na tabela `credentials` existente. O uso de IA reaproveita `llm_usage` (o provedor `bridge` é um novo valor de texto).

## Contratos

- **Tipos de nó:** `ai.bridgeChatModel` (sub-nó, `ai_languageModel`) e `ai.agentix` (`main` → `main`).
- **Tipos de credencial:** `bridgeApi` e `agentixApi` (campos do §1).
- **`HttpGuard.fetch(url, { insecureTls })`** e **`AiGateway.fetchFor({ insecureTls })`**.
- **`ChatModelProvider`:** acrescenta `bridge`.
- Sem rotas novas.

## Permissões RBAC

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|
| `credential:manage` / `credential:use` | Existentes | admin, editor | Cadastrar e usar as credenciais novas, como as demais |

## Configuração

Nenhuma variável nova. Os endereços internos da Bridge e do Agentix precisam estar em `OLLY_HTTP_ALLOWLIST` (orientado na documentação).

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Nó próprio `ai.bridgeChatModel` | Credencial `bridgeApi` no `ai.chatModel` | A Bridge tem parâmetros próprios (streaming, `n`, `stop`, `user`, modelo no corpo) e não usa a lista de modelos; um nó próprio espelha o N8N e simplifica a importação |
| Cache do token em memória por processo, com a chave id + `updatedAt` | Cache no Redis | Igual ao N8N; cada worker faz um login por ciclo do token, o que basta para o NFR-001 por processo; sem guardar o token fora da memória |
| Segundo agente HTTP com o mesmo `lookup` para `insecureTls` | `NODE_TLS_REJECT_UNAUTHORIZED` | Desligar só a credencial que pediu, sem afetar o processo, e mantendo o anti-SSRF |
| Espera do Agentix por sono interrompível no nó | Pausar a execução (`NodeWaitSignal`) | Decisão do PO; simples e igual ao N8N |
| Mesmos nomes de credencial do N8N | Nomes novos | O importador mapeia 1:1 e quem migra reconhece |

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001, FR-003, FR-006 | Unidade (servidor simulado) | `packages/nodes/src/ai/bridge/bridge.test.ts` |
| FR-004, FR-005, NFR-001 | Unidade | `packages/nodes/src/ai/bridge/token-manager.test.ts` |
| FR-002 (teste da credencial), FR-008 | Unidade | `packages/nodes/src/credentials/test.test.ts` (Bridge) e o registro das credenciais |
| FR-002/FR-008 (TLS), FR-013 | Unidade | `packages/nodes/src/shared/http-guard.test.ts` (HTTPS autoassinado com `insecureTls`; anti-SSRF continua) |
| FR-007, FR-009, FR-010, FR-011 | Unidade (servidor simulado) | `packages/nodes/src/ai/agentix/agentix.test.ts` |
| FR-001, FR-006, FR-014, SC-001, SC-002, SC-004 | Integração | `apps/api/src/ai/bridge.int.test.ts` (Agent com a Bridge simulada pela API: uso registrado, limite mensal, sentinelas) |
| FR-009, FR-010, FR-014, SC-003, SC-004 | Integração | `apps/api/src/ai/agentix.int.test.ts` (execução pela fila, "continuar" por item, cancelamento) |
| FR-012, SC-005 | Unidade | `apps/api/src/workflow-io/n8n/n8n.test.ts` (tipos `CUSTOM.*` e do pacote, credenciais, ferramenta → marcador) |
| FR-015 | Unidade | `apps/api/src/workflow-io/docs.test.ts` (os tipos novos documentados) |

## Riscos

| Risco | Mitigação |
|---|---|
| Verificação TLS desligada permite um intermediário ler as chamadas (risco aceito pelo PO) | Padrão desligado; descrição explícita na credencial; vale só para a credencial que a liga; o anti-SSRF continua; recomendação na documentação de preferir a CA interna |
| Comportamento real da Bridge e do Agentix diferente do simulado | SC-006 (validação em homologação); mensagens de erro com o status e um trecho da resposta |
| Espera do Agentix ocupando workers | Tempo limite configurável; concorrência do worker (spec 006) documentada para dimensionamento |
| Modelo digitado errado na Bridge | O erro da Bridge volta na execução com o status |

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 07/10/2026 | Criação, depois dos esclarecimentos do PO | Spec 016 |
