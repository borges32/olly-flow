# Relatório — Spec 016: Nós Bridge Chat Model e Agentix

**Status:** Implementada (pendente: SC-006, validação manual em homologação; workflows reais da POC)
**Data:** 07/10/2026

## Resumo

Foram entregues:
- **Nós:**
  - **`ai.bridgeChatModel`:** modelo de chat customizado da Bridge, sub-nó do Agent, com token de curta duração renovado em memória e novo login em 401/403;
  - **`ai.agentix`:** invoca um agente ou workflow do Agentix e espera a sessão dentro do nó.
- **Credenciais:** `bridgeApi` e `agentixApi`, sem endereços padrão e com a verificação TLS desligável.
- **`HttpGuard`:** opções por chamada `insecureTls` e `allowPrivateNetworks` (redes internas sem allowlist, só para os dois nós, sempre pelo filtro anti-SSRF).
- **Importação do N8N:** reconhece os tipos `CUSTOM.*` e os do pacote `n8n-nodes-bridge-chat-model`.
- **Testes:** servidores simulados da Bridge e do Agentix, em HTTP e em HTTPS autoassinado.
- **Documentação:** as páginas dos nós e as atualizações das demais.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `packages/nodes/src/ai/testing/service-mocks.ts` (`startBridgeMock`, `startAgentixMock`) e `test-tls.ts` (certificado só de teste), exportados por `@olly/nodes` |
| T002 | ✅ | `bridgeApiCredential` e `agentixApiCredential` em `credentials/definitions.ts`; teste da Bridge em `credentials/test.ts` |
| T010 | ✅ | `shared/http-guard.ts`: `insecureTls`, `allowPrivateNetworks`, um agente por combinação |
| T011 | ✅ | `AiGateway.fetchFor` (`ai/runtime/types.ts`, `apps/api/src/ai/ai-gateway.service.ts`); provedor `bridge` |
| T020 | ✅ | `ai/bridge/token-manager.ts` |
| T021 | ✅ | `ai/bridge/bridge-fetch.ts` |
| T022 | ✅ | `ai/bridge/definition.ts`; registro em `builtin.ts` |
| T023 | ✅ | `apps/api/src/ai/bridge.int.test.ts` |
| T030 | ✅ | `ai/agentix/definition.ts` |
| T031 | ✅ | `apps/api/src/ai/agentix.int.test.ts` |
| T040 | ✅ | `apps/api/src/workflow-io/n8n/converters.ts` e `convert.ts` |
| T050 | ✅ | `apps/web/src/editor/node-icons.ts` (`waypoints`, `bot-message-square`) |
| T051 | ✅ | `docs/nos/ai.bridgeChatModel.md`, `docs/nos/ai.agentix.md`, `workflow-json.md`, `credenciais.md`, `importacao-n8n.md` |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Tabelas abaixo |
| T092 | ✅ | `docs/nos/README.md`, `docs/arquitetura/contratos.md` |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `packages/nodes/src/ai/bridge/bridge.test.ts` › "FR-001/FR-003/FR-006/FR-013/FR-014 …", "FR-001: streaming ligado por padrão…", "FR-001: as opções vão no corpo…", "FR-001: chamadas de ferramenta…"; `apps/api/src/ai/bridge.int.test.ts` › "SC-001/FR-001/FR-003/FR-006 …" |
| FR-002 | Sim | `bridge.test.ts` › "FR-002/FR-008: endereços obrigatórios e sem valor padrão…", "FR-002: certificado autoassinado…", "FR-002: \"Testar\" faz o mesmo login…"; `http-guard.test.ts` › "FR-002/FR-008: HTTPS autoassinado…"; `bridge.int.test.ts` › "FR-002: \"Testar\"…" |
| FR-003 | Sim | `bridge.test.ts` › "FR-001/FR-003/…" e "…enviar o modelo no corpo…"; `bridge.int.test.ts` › "SC-001/…/FR-003…" |
| FR-004 | Sim | `packages/nodes/src/ai/bridge/token-manager.test.ts` › "FR-004: …" (4 casos); `bridge.int.test.ts` › "SC-002/FR-004/FR-005…" |
| FR-005 | Sim | `token-manager.test.ts` › "FR-005: invalidar descarta só o token recusado…"; `bridge.test.ts` › "FR-005: token recusado (401)…", "FR-005: um segundo 401…"; `bridge.int.test.ts` › "SC-002/…" |
| FR-006 | Sim | `bridge.test.ts` › "FR-001/FR-003/FR-006…" (`checkModel` não chamado); `bridge.int.test.ts` › "SC-001/…/FR-006…" (uso com provedor `bridge` e custo) e "FR-006: o limite mensal de tokens do projeto vale para a Bridge" |
| FR-007 | Sim | `packages/nodes/src/ai/agentix/agentix.test.ts` › "FR-007/FR-009/FR-013…", "FR-007: sem \"esperar o fim\"…" |
| FR-008 | Sim | `bridge.test.ts` › "FR-002/FR-008: endereços obrigatórios…", "FR-008: a credencial Agentix é validada na primeira execução…"; `agentix.test.ts` › "FR-008/FR-014: chave inválida…", "FR-008: certificado autoassinado…"; `agentix.int.test.ts` › "FR-008: \"Testar\"…" |
| FR-009 | Sim | `agentix.test.ts` › "FR-007/FR-009/FR-013…", "FR-009: \"todas as mensagens\"…"; `agentix.int.test.ts` › "SC-003/FR-009/FR-010…" |
| FR-010 | Sim | `agentix.test.ts` › "FR-010: a sessão em FAILED/CANCELLED/REJECTED…", "FR-010: o tempo limite…", "FR-010: com \"continuar\"…", "FR-010: com \"saída de erro\"…"; `agentix.int.test.ts` › "SC-003/…", "FR-010: com \"parar\"…", "FR-010: o tempo limite configurado no nó…" |
| FR-011 | Sim | `agentix.test.ts` › "FR-011: o cancelamento interrompe a espera na hora"; `agentix.int.test.ts` › "FR-011: cancelar a execução interrompe a espera pela sessão" |
| FR-012 | Sim | `apps/api/src/workflow-io/n8n/n8n.test.ts` › "FR-012/SC-005: com o prefixo …" (2 casos), "FR-012: valores padrão omitidos…", "FR-012: o Agentix como ferramenta de um AI Agent vira marcador" |
| FR-013 | Sim | `packages/nodes/src/shared/http-guard.test.ts` › "FR-013: …" (faixas aceitas, faixas bloqueadas, nome interno, redirect para loopback); `bridge.test.ts` e `agentix.test.ts` (as chamadas pedem `allowPrivateNetworks`) |
| FR-014 | Sim | `bridge.test.ts` (token registrado no mascaramento); `agentix.test.ts` › "FR-008/FR-014…"; `bridge.int.test.ts` › "SC-004/FR-014…"; `agentix.int.test.ts` › "SC-004/FR-014…" |
| FR-015 | Sim | `apps/api/src/workflow-io/docs.test.ts` › "SC-003: todo tipo de nó registrado está documentado" (inclui `ai.bridgeChatModel` e `ai.agentix`); páginas em `docs/nos/` |
| NFR-001 | Sim | `token-manager.test.ts` › "NFR-001: dezenas de chamadas simultâneas fazem um único login" (40 chamadas, 1 login) |
| NFR-002 | Sim | A espera é um `setTimeout` interrompível pelo `ctx.signal` (sem CPU entre as consultas), e o worker aborta esse sinal no encerramento (mecanismo da spec 006). Verificado indiretamente por `agentix.test.ts` › "FR-011…" e `agentix.int.test.ts` › "FR-011…" |
| NFR-003 | Sim | Todos os testes usam `startBridgeMock`/`startAgentixMock` |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `bridge.int.test.ts` › "SC-001/…" (conversa com ferramenta, endereço, token, sem `model`, streaming, uso registrado) e `bridge.test.ts` › "FR-002: certificado autoassinado…" (HTTPS autoassinado com a verificação desligada) |
| SC-002 | ✅ | `bridge.int.test.ts` › "SC-002/FR-004/FR-005…": renovação antes do vencimento sem 401 e um 401 com novo login, um login por ciclo |
| SC-003 | ✅ | `agentix.test.ts` (duas saídas, espera desligada, três estados de falha, tempo limite, falha transitória tolerada e não tolerada, chave inválida, "continuar") e `agentix.int.test.ts` |
| SC-004 | ✅ | `bridge.int.test.ts` e `agentix.int.test.ts` › "SC-004/FR-014…": senha, tokens e chave ausentes de logs (nível `trace`), respostas da API e das tabelas `node_executions`, `executions`, `audit_log`, `agent_steps`, `llm_usage` e `credentials` |
| SC-005 | ✅ (sintético) | `n8n.test.ts` › "FR-012/SC-005…": workflow com os dois nós importado sem marcadores. Os workflows reais da POC ainda não estão em `fixtures/n8n/` |
| SC-006 | Pendente | Validação manual em homologação, depois da liberação de acesso (pré-requisito humano) |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 758 testes (nodes 234, engine 128, expressions 124, web 89, api 57, …) |
| `pnpm test:integration` | ✅ 358 testes (api 304, db 28, nodes 23, engine 3), na terceira rodada. Ver a nota abaixo |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 44 cenários (com os contêineres `api`, `worker` e `web` parados, para o Playwright subir os próprios servidores; na primeira tentativa ele reaproveitou os contêineres do compose e 22 cenários falharam por ambiente) |
| `pnpm app:up && pnpm smoke` | ✅ (imagens reconstruídas com o código desta spec; contêineres saudáveis) |

**Rodadas da integração:**
- **1ª rodada:** falhou o teste da lista exata de tipos de credencial (`credentials.int.test.ts`), que precisava dos tipos novos. Corrigido.
- **2ª rodada:** falhou o "SC-004: a aprovação sobrevive à troca de worker" (`approval.int.test.ts`, spec 011). Esse teste não usa nada desta spec: tinha passado na 1ª rodada, passou 3 de 3 vezes isolado e passou na 3ª rodada completa. É intermitente sob carga (qual worker processa a retomada); fica registrado para investigação.
- **3ª rodada:** tudo verde.

## Decisões tomadas

- **Redes internas sem violar a constituição (Art. III.5):** as chamadas dos dois nós continuam no `HttpGuard`, e a opção `allowPrivateNetworks` só libera as faixas `private`, `carrierGradeNat` e `uniqueLocal`. Loopback, link-local (metadados da nuvem), endereços reservados e os IPv6 com IPv4 embutido continuam bloqueados, com DNS validado na conexão e redirects revalidados.
- **Um agente HTTP por combinação de opções**, criado sob demanda, todos com o `lookup` validado: o TLS desligado vale só para a chamada que pediu, sem afetar o processo.
- **`BridgeTokenManager.invalidate(credencial, token)`** só descarta o token recusado: uma chamada simultânea que já obteve um token novo não o perde.
- **O LangChain já não repete 401/403** (`STATUS_NO_RETRY`), então o `onFailedAttempt` do nó do N8N não foi necessário: a repetição única fica no `fetch` da Bridge.
- **Agentix com "saída de erro":** além de "parar" e "continuar", o item que falha pode ir para a porta `error` (como os demais nós por item).
- **Servidores simulados exportados por `@olly/nodes`**, como o modelo simulado da spec 011: assim os testes de unidade e de integração (API) usam os mesmos simuladores (NFR-003). O certificado autoassinado embutido serve só aos testes.

## Desvios da spec/plano

- **Ícone do Agentix:** `bot-message-square` em vez de `bot`, que já é o ícone do Agent. Registrado no histórico do plano.
- Os demais detalhes de implementação (servidores simulados exportados, invalidação só do token recusado) foram registrados no histórico do plano. Spec e plano estão alinhados ao código.

## Correção após a implementação: erro 403 do Agentix em dev

Relatado pelo PO ao testar em dev. A causa exata não aparece no erro antigo, que só trazia o status. Comparando o nó com o exemplo da API (`Bridge-Chat-Model/prompt/Agentix`) e com o tráfego real do nó, foram corrigidos:
- **User-Agent:** o nó enviava `user-agent: undici` (padrão do `fetch`), que WAFs e gateways corporativos costumam barrar com 403. Agora envia `Olly-Flow/1.0 (agentix)`.
- **URL base:** o exemplo mostra o endpoint completo (`…/v2/api/sessions/invoke`). Colado na credencial, o nó chamava `…/sessions/invoke/sessions/invoke`, e um caminho não mapeado costuma voltar 403 ou 404 do gateway. Agora a raiz da API é extraída (`agentixBaseUrl`), e a chave passa sem espaços nas pontas.
- **Diagnóstico:** em erro, a mensagem traz o endereço chamado (sem a chave) e o motivo devolvido (`detail`). Em 401/403, orienta a conferir a chave e a URL base.
- **Formato real da API:** a criação devolve `status`, e não `state`. Uma criação já `REJECTED`, `FAILED` ou `CANCELLED` agora encerra o item sem consultar; um `error_message` nulo não aparece na mensagem; no tempo limite com `BLOCKED`, a mensagem explica que a sessão aguarda uma interação.
- **Simulador:** passou a seguir o exemplo da API (`/v2/api`, `status` na criação, campos nulos, 403 `Not authenticated` sem a chave).

Testes que reproduzem e comprovam (escritos antes da correção, falhando): `agentix.test.ts` › "FR-008: o 403 mostra o endereço chamado…", "FR-008: URL base colada com o endpoint…" (3 casos), "FR-008: o nó se identifica no User-Agent…", "FR-009: com as mensagens do exemplo da API…", "FR-010: sessão recusada já na criação…", "FR-010: error_message nulo…/BLOCKED…". Se o 403 continuar, a nova mensagem mostra o motivo exato para a próxima análise.

## Dependências adicionadas

Nenhuma. A Bridge usa o `@langchain/openai` (`ChatOpenAI`) e o `undici`, que já estavam no projeto.

## Pendências, bloqueios e riscos

**Pré-requisitos humanos:**
- **SC-006:** validação manual em homologação com a Bridge e o Agentix reais (usuário de serviço e chave).
- **Fixtures:** workflows da POC com os dois nós em `fixtures/n8n/` (confirmados pelo PO; ainda não entregues). O SC-005 foi verificado com um workflow sintético.

**Riscos:**
- **Redes privadas sem allowlist** (aceito pelo PO): quem gerencia credenciais (admin e editor) pode apontar os dois nós para outros serviços internos e ler até 500 caracteres da resposta nas mensagens de erro. Recomenda-se revisão de Segurança.
- **Verificação TLS desligada** (aceito pelo PO): vale só para a credencial que a liga; a documentação recomenda instalar a CA interna.
- **Uso de tokens com streaming:** com os padrões (streaming ligado e `streamUsage` desligado), a Bridge não devolve o uso. O registro fica com 0 tokens e o limite mensal não conta essas chamadas. Documentado na página do nó; vale confirmar na homologação se a Bridge aceita `stream_options.include_usage`.
- **Workers ocupados:** a espera do Agentix ocupa um worker durante a sessão; dimensione a concorrência (spec 006).
- **Teste intermitente** da spec 011 (`approval.int.test.ts`, SC-004), sem relação com esta spec (ver acima).

## Como demonstrar

1. `pnpm app:up` e entre no editor (`http://localhost:5173`).
2. Em **Credenciais**, crie uma credencial **IA: Bridge** com os endereços da homologação (ou de um simulador; lembre que um simulador na própria máquina fica em loopback, que exige `OLLY_HTTP_ALLOWLIST`). Clique em **Testar**: deve aparecer "Login bem-sucedido".
3. Monte **Gatilho manual → Agent**, ligue um **Bridge Chat Model** à entrada de modelo e informe o nome do modelo (texto livre). Execute.
4. Acrescente um nó **Agentix** com uma credencial **Agentix** e execute; teste "continuar" com uma entidade que falhe.
5. Em **Importar**, escolha o formato N8N e cole um workflow com `CUSTOM.bridgeChatModel` e `CUSTOM.agentix`: os dois chegam convertidos, com as credenciais a cadastrar no relatório.

## Próximos passos sugeridos

- Revisão de Segurança do acesso a redes privadas pelos dois nós.
- Investigar o teste intermitente `approval.int.test.ts` (SC-004 da spec 011).
- Avaliar pausar a execução durante sessões longas do Agentix, se a ocupação de workers incomodar.
- Avaliar o Agentix como ferramenta do Agent, se surgir demanda.
