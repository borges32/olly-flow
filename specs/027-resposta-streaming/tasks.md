# Tarefas — Spec 027: Resposta em streaming no Webhook e no Chat Trigger

**Spec:** [spec.md](spec.md) · **Plano:** [plan.md](plan.md)

**Legenda:**
- `[P]`: pode ser executada em paralelo com outras `[P]` da mesma fase (arquivos diferentes, sem dependência).
- `(FR-xxx)`: requisitos atendidos.
- `→ plan §X`: seção do plano com o detalhe técnico.

Marque `- [x]` ao concluir. Não pule fases: cada fase depende da anterior.

## Fase 1 — Fundação

- [ ] T001 Conferir o formato de streaming do N8N (tipos, `metadata`, `Content-Type`) na documentação oficial e ajustar o plan §1 se divergir (FR-001) → plan §1
- [ ] T002 [P] Migration `0019_project_stream_limit` (up/down), schema do `packages/db` e testes de migration (FR-006) → plan "Modelo de dados"
- [ ] T003 [P] `StreamEvent` em `packages/shared-types`; `streaming` no `responseMode` do Webhook e do Chat Trigger, com a descrição (nomes dos nós visíveis a quem chama) (FR-001, FR-005) → plan §1, §3, §4
- [ ] T004 [P] Configuração `OLLY_WEBHOOK_STREAM_MAX_PER_PROJECT` e `OLLY_WEBHOOK_STREAM_PING_SECONDS` (zod, `.env.example`, `k3s/configmap.yaml`) → plan "Configuração"

## Fase 2 — HU-1/HU-3: Webhook em streaming e limite (P1)

- [ ] T010 `beforeDispatch` no `ExecutionsService.launch` (FR-002, NFR-002) → plan §2
- [ ] T011 `ExecutionStream`: ouvintes por execução sobre o canal Redis, formato §1, sinal periódico, fim por sucesso/erro/espera/teto, desconexão; testes de unidade do formato (FR-001 a FR-004) → plan §1, §2
- [ ] T012 `StreamLimiter` (Redis, Lua, validade) e `maxWebhookStreams` no `PUT /projects/:id/quota`, auditado (FR-006) → plan §5
- [ ] T013 Modo `streaming` no gateway do webhook (produção e teste) e aviso de publicação com "Responder ao webhook" (FR-001 a FR-004, FR-007) → plan §3
- [ ] T014 Integração `webhook-stream.int.test.ts`: ordem e tempo dos passos, só metadados, resposta final (último nó e "Responder ao webhook"), erro, fila, espera, desconexão, `ping`, autenticação, limite e vaga, duas instâncias da API (FR-001 a FR-004, FR-006, FR-007, NFR-001, NFR-002, SC-001 a SC-003)

## Fase 3 — HU-2: Chat em streaming (P1)

- [ ] T020 `POST …/chat` em `streaming` no `ChatService`, com sessão ocupada e limite de taxa; integração em `chat.int.test.ts` (FR-005, FR-006) → plan §4
- [ ] T021 Chat hospedado e incorporado: leitura do stream e passo atual; painel do editor: passo atual pelo estado da execução de teste (FR-005) → plan §4
- [ ] T022 E2E em `chat.spec.ts`: passo atual e resposta no chat hospedado e no painel do editor (SC-004)

## Fase 4 — HU-4: Importação (P2)

- [ ] T030 Importador do N8N: `streaming` do Webhook e do Chat Trigger, com aviso; testes em `n8n.test.ts` (FR-008) → plan §7

## Fase 5 — Infra, documentação e verificação

- [ ] T090 nginx (`infra/docker/nginx.conf`, `k3s/web-nginx-configmap.yaml`) sem buffer nem compressão no `/webhook`; comentário da Route em `k3s/web.yaml` e `k3s/README.md` → plan §6
- [ ] T091 Documentação: `docs/nos/trigger.webhook.md` e `docs/nos/trigger.chat.md` (formato, exemplos com curl, Python e JavaScript, proxies), `contratos.md`, `modelo-dados.md`, `docs/nos/workflow-json.md` (FR-009)
- [ ] T092 Atualizar a spec 021 (FR-005: modo novo; histórico) e a spec 005 (histórico)
- [ ] T093 Rodar todos os comandos de verificação do AGENTS.md
- [ ] T094 Conferir que cada FR tem teste que o cita e cada SC foi verificado
- [ ] T095 Escrever `report.md` e atualizar o status em `spec.md` e `docs/roadmap.md`
