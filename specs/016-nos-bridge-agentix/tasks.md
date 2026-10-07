# Tarefas — Spec 016: Nós Bridge Chat Model e Agentix

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Preparação

- [x] T001 Servidores simulados da Bridge (login, `chat/completions` com e sem streaming, 401 controlado, HTTP e HTTPS autoassinado) e do Agentix (invoke, estados roteirizados, mensagens), reutilizáveis nos testes de unidade e de integração (NFR-003) → plan "Estratégia de testes"
- [x] T002 [P] Credenciais `bridgeApi` e `agentixApi`, sem endereços padrão e com `allowUnauthorizedCerts` (FR-002, FR-008) → plan §1

## Fase 2 — Fundação (bloqueia as histórias)

- [x] T010 `HttpGuard`: opções `insecureTls` e `allowPrivateNetworks`, com um agente por combinação e o mesmo `lookup` validado, com testes (HTTPS autoassinado; redes privadas aceitas; loopback, link-local e metadados da nuvem barrados; regra da spec 004 inalterada sem a opção) (FR-002, FR-008, FR-013) → plan §2
- [x] T011 `AiGateway.fetchFor({ insecureTls, allowPrivateNetworks })` na API; provedor `bridge` em `ChatModelProvider` → plan §2, §3

## Fase 3 — HU-1: Bridge Chat Model (P1)

- [x] T020 [P] Gerenciador do token: cache por credencial, `exp`/margem/padrão de 20 min, logins unificados, invalidação, com testes (FR-004, NFR-001) → plan §3
- [x] T021 `fetch` da Bridge: Bearer, `model` fora do corpo, novo login e repetição em 401/403, chamadas com `allowPrivateNetworks`, com testes (FR-003, FR-005, FR-013) → plan §3
- [x] T022 Nó `ai.bridgeChatModel` e teste da credencial (login), com testes de unidade contra a Bridge simulada (streaming e uso de tokens) (FR-001, FR-002, FR-006) → plan §1, §3
- [x] T023 Integração: Agent com a Bridge simulada pela API (ferramenta, uso registrado, limite mensal, sem lista de modelos, expiração e 401 numa execução, sentinelas) (FR-001, FR-006, FR-014, SC-001, SC-002, SC-004)

## Fase 4 — HU-2: Agentix (P1)

- [x] T030 Nó `ai.agentix`: invoke, espera interrompível, mensagens, saídas, erros por estado e por tempo, erros de consulta, chamadas com `allowPrivateNetworks`, com testes de unidade (FR-007, FR-009, FR-010, FR-011, FR-013) → plan §4
- [x] T031 Integração: execução pela fila com o Agentix simulado, "continuar" por item, cancelamento durante a espera, sentinela da chave (FR-009, FR-010, FR-011, FR-014, SC-003, SC-004)

## Fase 5 — HU-3: Migração do N8N (P1)

- [x] T040 Conversores do importador para os tipos `CUSTOM.*` e do pacote, credenciais e Agentix como ferramenta → marcador, com testes (FR-012, SC-005) → plan §5

## Fase 6 — Editor e documentação

- [x] T050 [P] Ícones dos nós no editor → plan §6
- [x] T051 Documentação: `docs/nos/ai.bridgeChatModel.md`, `docs/nos/ai.agentix.md`, catálogo e credenciais em `docs/nos/workflow-json.md`, `docs/credenciais.md` (TLS e endereços internos sem allowlist para os dois nós), `docs/importacao-n8n.md` (FR-015)

## Fase 7 — Verificação e relatório

- [x] T090 Rodar todos os comandos de verificação do AGENTS.md
- [x] T091 Conferir que cada FR tem teste que o cita e cada SC foi verificado (SC-006 é manual, em homologação)
- [x] T092 Atualizar a documentação (`docs/nos/README.md`, `docs/arquitetura/contratos.md`)
- [x] T093 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
