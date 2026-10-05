# Roadmap — Olly Flow

> Ordem de implementação das specs, status, marcos e pré-requisitos humanos. Processo de trabalho: [AGENTS.md](../AGENTS.md). Princípios: [constituição](../.specify/memory/constitution.md).

## Specs

**Status:** `Rascunho` → `Planejada` → `Aprovada` → `Em implementação` → `Implementada` → `Verificada` (após revisão humana).

| # | Spec | Fase | Objetivo | Depende de | Status | Marco |
|---|---|---|---|---|---|---|
| 001 | [fundacao](../specs/001-fundacao/spec.md) | 0 — Fundação | Monorepo, Compose, OIDC, banco, contratos, CI | — | Verificada ([relatório](../specs/001-fundacao/report.md)) | |
| 002 | [editor-workflows-rbac](../specs/002-editor-workflows-rbac/spec.md) | 1 — MVP | Canvas, CRUD de workflows, RBAC por projeto, esqueleto do motor | 001 | Verificada ([relatório](../specs/002-editor-workflows-rbac/report.md)) | |
| 003 | [expressoes-execucao-teste](../specs/003-expressoes-execucao-teste/spec.md) | 1 — MVP | Expressões N8N em sandbox, If, `$vars`, execução de teste, log | 002 | Verificada ([relatório](../specs/003-expressoes-execucao-teste/report.md)) | |
| 004 | [credenciais-http-postgres](../specs/004-credenciais-http-postgres/spec.md) | 1 — MVP | Credenciais, anti-SSRF, HTTP, Postgres, retry/timeout | 003 | Verificada ([relatório](../specs/004-credenciais-http-postgres/report.md)) | |
| 005 | [webhook-codigo-js-mvp](../specs/005-webhook-codigo-js-mvp/spec.md) | 1 — MVP | Webhook, publicação, código JS, execuções, matriz RBAC, POC | 004 | Verificada ([relatório](../specs/005-webhook-codigo-js-mvp/report.md)) — SC-001 pendente (fixtures da POC) | 🏁 MVP + Go/No-Go |
| 006 | [fila-workers-paralelismo](../specs/006-fila-workers-paralelismo/spec.md) | 2 — Execução avançada | Fila, workers, DAG paralelo, cancelamento, cotas | 005 + Go | Implementada ([relatório](../specs/006-fila-workers-paralelismo/report.md)) | |
| 007 | [controle-de-fluxo](../specs/007-controle-de-fluxo/spec.md) | 2 — Execução avançada | Merge, While, Loop, Switch, porta de erro, error workflow | 006 | Implementada ([relatório](../specs/007-controle-de-fluxo/report.md)) | |
| 008 | [python-agendamento-subworkflow](../specs/008-python-agendamento-subworkflow/spec.md) | 2 — Execução avançada | Python isolado, cron, sub-workflow, Wait, reexecução, paginação | 007 | Aprovada | 🏁 Motor completo |
| 009 | [governanca-lgpd-sso](../specs/009-governanca-lgpd-sso/spec.md) | 3 — IA e governança | Vault/KMS, SSO, versionamento, aprovação, mascaramento, retenção | 008 | Aprovada | |
| 010 | [cliente-mcp](../specs/010-cliente-mcp/spec.md) | 3 — IA e governança | Catálogo, cliente MCP, OAuth, políticas, auditoria | 009 | Aprovada | |
| 011 | [ai-agent](../specs/011-ai-agent/spec.md) | 3 — IA e governança | Chat model, Agent, tools, memória, aprovação humana, custo | 010 | Aprovada | 🏁 Agents em homologação |
| 012 | [observabilidade-importador-homologacao](../specs/012-observabilidade-importador-homologacao/spec.md) | 4 — Hardening | OTel, Grafana, importador N8N, Helm, carga | 011 | Aprovada | |
| 013 | [hardening-go-live](../specs/013-hardening-go-live/spec.md) | 4 — Hardening | Pentest, documentação, execução paralela ao N8N, go-live | 012 | Aprovada | 🚀 Go-live |
| 014 | [primeiro-usuario](../specs/014-primeiro-usuario/spec.md) | 1 — MVP (apoio à UX) | Cadastro do primeiro usuário numa instalação nova | 002 | Rascunho | |

As specs estão organizadas por escopo, não por calendário. A referência original era de 13 sprints de 2 semanas com uma equipe de 4 pessoas. Com implementação por agente de IA, o ritmo depende principalmente das revisões humanas entre specs.

## Pontos de controle humano

Entre cada spec, antes de iniciar a próxima:
1. Revisar o código (pull/merge request) e o `report.md`.
2. Executar a demonstração descrita no relatório.
3. Resolver as pendências e os `[PRECISA ESCLARECIMENTO]` registrados.
4. Atualizar as ADRs que mudaram de status.
5. Marcar a spec como `Verificada` nesta tabela.

## Pré-requisitos humanos por spec

| Antes de | Atividade | Responsável |
|---|---|---|
| 001 | ~~Confirmar ADRs 0002–0004~~ (aceitas em 03/10/2026); exportar workflows de referência da POC para `fixtures/n8n/` | Tech lead + PO |
| 002–005 | Revisar código e relatórios; validar UX do editor com usuários da POC | Tech lead + PO |
| 006 | ~~**Go/No-Go** (TCO vs. N8N Enterprise) registrado em ADR; ADR-0006 (infraestrutura)~~ (Go na [ADR-0009](adr/0009-go-no-go.md), 05/10/2026; ADR-0006 aceita em 04/10/2026) | Gestão + PO |
| 009 | ADR-0005 (IdP) e ADR-0007 (Vault/KMS) decididas, com acessos de homologação | Infra + Segurança |
| 011 | ADR-0008 (provedores e modelos de LLM aprovados) e chaves de homologação | Gestão + Segurança + Jurídico/LGPD |
| 012 | Exportar **todos** os workflows da POC; agendar pentest; ambiente de homologação; metas de carga (NFR-G08) | PO + Segurança + Infra |
| 013 | Relatório do pentest; data e janela do go-live; aprovação de riscos aceitos | Segurança + Gestão |
| 014 | Decidir a relação com a NFR-G03 (credencial no IdP ou local) e resolver os pontos em aberto da spec | PO + Segurança |
| Pós 013 | Deploy em produção, treinamento, reteste do pentest, hypercare, desligamento do N8N | Infra + PO + Segurança |

## Decisões pendentes

| ADR | Assunto | Decidir até | Se não estiver decidida |
|---|---|---|---|
| 0005 | IdP institucional | 009 | Keycloak local + pendência registrada |
| 0007 | Vault/KMS | 009 | Vault local em modo dev |
| 0008 | Provedores de LLM | 011 | Provedor compatível com a API OpenAI + modelo fake nos testes |

## Backlog pós go-live (candidatos a novas specs)

- Templates de workflow e biblioteca de componentes reutilizáveis.
- Ambientes (dev/hml/prod) com promoção de workflows e integração com Git.
- Novos nós: e-mail, filas (RabbitMQ/Kafka), arquivos (S3/SFTP), Excel/CSV, conectores internos.
- RAG: vector store (pgvector), embeddings, loaders de documentos.
- Chat trigger (interface de chat para agentes).
- `fetch` controlado no nó de código JS.
- Notificações por e-mail/Teams (aprovações, falhas).
- Marketplace interno de nós via SDK.
