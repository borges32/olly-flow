# Planejamento de Sprints — Olly Flow

> Documentos base: [analise_implementacao.md](analise_implementacao.md) · [decisoes.md](decisoes.md)
>
> A implementação é feita por um **agente de IA de codificação**. Cada sprint é um **prompt autocontido** em [`docs/sprints/`](sprints/). Este arquivo é o índice e o guia de uso.
>
> **Duração de referência:** 13 sprints. Os prompts são organizados por escopo, não por calendário: o ritmo real depende do agente e das revisões humanas entre as sprints.

---

## Como usar os prompts

1. **Uma sprint por sessão do agente.** Inicie uma sessão nova para cada sprint, com o repositório na raiz, e envie:

   ```text
   Execute a sprint descrita em docs/sprints/sprint-XX.md.
   Antes de começar, leia docs/sprints/00-contexto-global.md e siga todas as regras.
   ```

2. **Contexto global.** [`00-contexto-global.md`](sprints/00-contexto-global.md) define a stack, a estrutura do repositório, os contratos, as regras de segurança, os comandos de verificação, o Definition of Done e o **formato do relatório** que o agente deve gerar. Todo prompt de sprint depende dele.

3. **Relatório ao final.** O agente escreve `docs/relatorios/sprint-XX.md`. A próxima sprint lê os relatórios anteriores, então **revise o relatório antes de seguir**.

4. **Ponto de controle humano entre sprints:**
   - revisar o código (pull/merge request) e o relatório;
   - executar a demo descrita em "Como demonstrar";
   - responder as pendências e decisões registradas;
   - atualizar `docs/decisoes.md` se alguma ADR mudou de status;
   - só então iniciar a próxima sprint.

5. **Se a sprint não fechar** (status "Não concluída" ou "Concluída com pendências"), rode uma nova sessão:

   ```text
   Conclua as pendências da sprint XX listadas em docs/relatorios/sprint-XX.md,
   seguindo docs/sprints/sprint-XX.md e docs/sprints/00-contexto-global.md.
   Atualize o relatório ao final.
   ```

6. **Sprints grandes:** se a sessão do agente ficar longa demais, divida pelos blocos de tarefas (`T1–T4`, `T5–T8`...) usando o mesmo prompt e pedindo explicitamente o subconjunto. O relatório é atualizado a cada bloco.

---

## Visão geral

| Sprint | Prompt | Fase | Objetivo | Marco |
|---|---|---|---|---|
| S0 | [sprint-00.md](sprints/sprint-00.md) | 0 — Fundação | Monorepo, Docker Compose, OIDC, banco, contratos, CI | Login funcionando, CI verde |
| S1 | [sprint-01.md](sprints/sprint-01.md) | 1 — MVP | Canvas, CRUD de workflows, RBAC por projeto, esqueleto do motor | Criar e salvar workflow |
| S2 | [sprint-02.md](sprints/sprint-02.md) | 1 — MVP | Expressões compatíveis com N8N em sandbox, If, `$vars`, execução de teste em tempo real | Executar pelo editor e ver os dados |
| S3 | [sprint-03.md](sprints/sprint-03.md) | 1 — MVP | Credenciais criptografadas, anti-SSRF, HTTP Request, Postgres query/escrita, retry/timeout | Integração real com API e banco |
| S4 | [sprint-04.md](sprints/sprint-04.md) | 1 — MVP | Webhook, publicação, código JS, tela de execuções, matriz RBAC, workflows da POC | 🏁 **MVP + Go/No-Go** |
| S5 | [sprint-05.md](sprints/sprint-05.md) | 2 — Execução avançada | BullMQ, workers, agendador DAG paralelo, cancelamento, cotas, carga | Execução distribuída e paralela |
| S6 | [sprint-06.md](sprints/sprint-06.md) | 2 — Execução avançada | Merge N entradas, While, Loop Over Items, Switch, porta de erro, error workflow | Fluxos complexos |
| S7 | [sprint-07.md](sprints/sprint-07.md) | 2 — Execução avançada | Python (nsjail), cron, sub-workflow, Wait, reexecução, paginação, testes de escape | 🏁 **Motor completo** |
| S8 | [sprint-08.md](sprints/sprint-08.md) | 3 — IA e governança | Vault/KMS, SSO institucional, versionamento e diff, aprovação, mascaramento LGPD, retenção | Governança institucional |
| S9 | [sprint-09.md](sprints/sprint-09.md) | 3 — IA e governança | Catálogo MCP, cliente MCP (HTTP/SSE/stdio), OAuth, políticas de tools, auditoria | Chamadas MCP governadas |
| S10 | [sprint-10.md](sprints/sprint-10.md) | 3 — IA e governança | Chat model, AI Agent (LangGraph), tools, memória, aprovação humana, custo | 🏁 **Agents em homologação** |
| S11 | [sprint-11.md](sprints/sprint-11.md) | 4 — Hardening | OpenTelemetry, Grafana, importador N8N, Helm, homologação, testes de carga | Homologação completa |
| S12 | [sprint-12.md](sprints/sprint-12.md) | 4 — Hardening | Correções do pentest, documentação, execução paralela ao N8N, artefatos de go-live | 🚀 **Go-live** |

---

## Atividades humanas por sprint

O agente de IA implementa. As atividades abaixo dependem de pessoas e são **pré-requisitos** dos prompts.

| Antes de | Atividade humana | Responsável |
|---|---|---|
| S0 | Confirmar ADRs 002–004; exportar workflows de referência da POC para `fixtures/n8n/` (workflow, entrada e saída esperada) | Tech lead + PO |
| S1–S4 | Revisar código e relatórios; validar UX do editor com usuários da POC nas demos | Tech lead + PO |
| S5 | **Reunião de Go/No-Go** (TCO vs. N8N Enterprise) registrada em `decisoes.md`; ADR-006 (infraestrutura) | Gestão + PO |
| S8 | ADR-005 (IdP institucional) e ADR-007 (Vault/KMS) decididas, com acessos de homologação | Infra + Segurança |
| S10 | ADR-008 (provedores e modelos de LLM aprovados) e chaves de homologação | Gestão + Segurança + Jurídico/LGPD |
| S11 | Exportar **todos** os workflows da POC; contratar/agendar pentest; acesso ao ambiente de homologação; metas de carga | PO + Segurança + Infra |
| S12 | Entregar relatório do pentest; definir data e janela do go-live; aprovar riscos aceitos | Segurança + Gestão |
| Pós S12 | Deploy em produção, treinamento, reteste do pentest, hypercare, desligamento do N8N | Infra + PO + Segurança |

### Decisões pendentes e sprint-limite

| ADR | Assunto | Precisa estar decidido até | Se não estiver |
|---|---|---|---|
| 002, 003, 004 | Stack backend, sandbox JS, runner Python | Início da S0 | O agente segue a proposta |
| 005 | Provedor de identidade (IdP) | S8 | O agente usa Keycloak local e registra a pendência |
| 006 | Infraestrutura (Kubernetes / nuvem) | S5 (workers) / S11 (Helm) | Docker Compose; Helm genérico testado em kind/k3d |
| 007 | Vault / KMS | S8 | Vault local em modo dev |
| 008 | Provedores de LLM | S10 | Provedor compatível com a API OpenAI + modelo fake nos testes |

---

## Artefatos gerados pelo agente

| Pasta | Conteúdo |
|---|---|
| `docs/relatorios/` | Relatório de cada sprint (status, entregas, decisões, desvios, demo) |
| `docs/nos/` | Documentação de cada nó |
| `docs/` | `expressoes.md`, `execucao.md`, `credenciais.md`, `governanca.md`, `lgpd.md`, `mcp-governanca.md`, `seguranca-sandbox.md`, `seguranca-agentes.md`, `observabilidade.md`, `deploy.md`, `rbac-matriz.md` |
| `docs/migracao/` | Relatório de importação da POC e comparação com o N8N |
| `docs/usuario/`, `docs/operacao/`, `docs/desenvolvimento/`, `docs/treinamento/`, `docs/go-live/` | Documentação final (S12) |

---

## Backlog futuro (pós go-live)

- Templates de workflow e biblioteca de componentes reutilizáveis.
- Ambientes (dev/hml/prod) com promoção de workflows e integração com Git.
- Novos nós: e-mail, filas (RabbitMQ/Kafka), arquivos (S3/SFTP), Excel/CSV, conectores internos.
- Nós de RAG: vector store (pgvector), embeddings, loaders de documentos.
- Chat trigger (interface de chat para agentes).
- `fetch` controlado no nó de código JS.
- Notificações por e-mail/Teams (aprovações, falhas).
- Marketplace interno de nós via SDK.
