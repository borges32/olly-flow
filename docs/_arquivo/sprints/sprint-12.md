# Sprint 12 — Correções, documentação e go-live

> **Prompt para o agente de IA.** Antes de começar, leia `docs/sprints/00-contexto-global.md` e siga todas as regras. Leia também **todos** os relatórios em `docs/relatorios/`, `docs/deploy.md` e o relatório do pentest em `docs/seguranca/pentest/`.

## Pré-requisitos

- Sprint 11 concluída e todos os comandos da seção 8 passando.
- **Humano:** relatório do pentest disponível em `docs/seguranca/pentest/` (achados com ID, severidade, descrição e evidência).
- **Humano:** data do go-live, janela de manutenção e responsáveis definidos.

## Contexto

Última sprint antes da produção. O foco é eliminar vulnerabilidades, deixar a plataforma documentada para usuários e operação, concluir a migração da POC e preparar o go-live com um caminho de volta seguro.

> **Divisão de responsabilidades:** o agente de IA executa as tarefas técnicas e de documentação desta sprint. Estas atividades são **humanas**, e o agente apenas prepara os materiais:
> - executar o deploy em produção;
> - conduzir o treinamento;
> - aprovar o go-live;
> - fazer o reteste do pentest.

## Objetivo

Corrigir os achados do pentest, produzir a documentação completa, concluir a migração com execução em paralelo ao N8N e entregar os artefatos de go-live (runbooks, backup/restore, rollback, hypercare).

## Tarefas

### T1 — Correção dos achados do pentest
- Para cada achado em `docs/seguranca/pentest/`, em ordem de severidade:
  1. reproduza com um **teste automatizado** que falha;
  2. corrija;
  3. confirme que o teste passa.
- **Críticos e altos:** correção obrigatória. **Médios:** corrija ou documente a mitigação/aceite de risco para decisão humana. **Baixos:** registre no backlog.
- Gere `docs/seguranca/pentest/plano-de-acao.md` com a tabela: ID, severidade, status (corrigido | mitigado | risco aceito pendente de aprovação | backlog), teste que cobre e commit/PR.
- **Não** marque nenhum achado como "risco aceito" por conta própria: isso exige aprovação humana. Use "pendente de aprovação".

### T2 — Revisão final de segurança
- Rode e registre:
  - `pnpm audit` e auditoria das dependências Python (`pip-audit`);
  - scan das imagens Docker (Trivy);
  - verificação de segredos no repositório (gitleaks).
- Revise os cabeçalhos de segurança do frontend e da API:
  - CSP, HSTS, `X-Content-Type-Options` e `frame-ancestors`;
  - CORS restrito;
  - cookies `Secure`/`HttpOnly`/`SameSite`, se usados.
- Confirme que o Swagger está desligado e que o *password grant* e os usuários de teste não existem na configuração de produção (teste que valida o `values-prod.yaml`).

### T3 — Documentação do usuário (`docs/usuario/`)
- Guia de primeiros passos: criar, testar e publicar um workflow.
- Referência de **todos os nós** (consolidando `docs/nos/*.md`): parâmetros, exemplos, saídas e diferenças em relação ao N8N.
- Guia de expressões com exemplos práticos.
- Guia de agentes e MCP: como montar um agente, boas práticas de prompt, aprovação de ações.
- Guia de migração para quem vem do N8N: o que muda (paralelismo, While, Merge, `$vars`, permissões).
- FAQ e solução de problemas comuns (erros de expressão, timeouts, sandbox).

### T4 — Documentação de operação (`docs/operacao/`)
- **Runbook:**
  - instalação, upgrade e rollback (Helm);
  - escalar workers;
  - rotação de chave mestra;
  - rotação de credenciais de infraestrutura;
  - recuperar execuções presas;
  - limpar a fila;
  - resposta a alertas (um procedimento por alerta da Sprint 11).
- **Backup e restore:** PostgreSQL (com PITR, se disponível), MinIO/S3 e configuração do Vault. Inclua um **script e teste de restore** executado em homologação, com o resultado registrado.
- **Plano de rollback do go-live**, com critérios objetivos para acioná-lo.
- Guia do administrador: usuários, papéis, mapeamento SSO, catálogo MCP, modelos de IA, cotas, retenção e mascaramento.

### T5 — SDK para novos nós (`docs/desenvolvimento/`)
- Guia "Como criar um nó": contrato `NodeDefinition`, `paramsSchema` e `x-display-options`, credenciais, paired items, testes, documentação.
- Um nó de exemplo completo (`examples/node-template/`) com testes.
- Guia de contribuição: padrões, Definition of Done e como escrever o relatório de mudança.

### T6 — Migração e execução em paralelo
- Ajuste os workflows da POC que ficaram pendentes no `docs/migracao/relatorio-poc.md`: resolva os placeholders ou registre a decisão humana necessária.
- Crie a ferramenta `pnpm migration:shadow`: para cada workflow migrado, recebe as execuções reais do N8N (export ou API do N8N, configurável) e reexecuta no Olly Flow com a mesma entrada, comparando as saídas. Nós com efeitos colaterais (Postgres write, HTTP POST, MCP destrutivo) rodam em **modo simulado** (*dry-run*, sem efeito) durante a comparação.
- Gere `docs/migracao/comparacao.md` com a equivalência por workflow e as divergências explicadas.

### T7 — Artefatos de go-live
- `docs/go-live/checklist.md`:
  - pré-requisitos de infraestrutura;
  - segredos criados;
  - IdP configurado;
  - backups ativos;
  - alertas roteados;
  - migrations aplicadas;
  - smoke test;
  - workflows publicados;
  - webhooks dos sistemas de origem apontados para o Olly Flow;
  - N8N com os fluxos migrados desativados.
- `values-prod.yaml` de referência (sem segredos) revisado.
- Smoke test de produção não destrutivo (`pnpm smoke:prod`).
- `docs/go-live/hypercare.md`: período (2–4 semanas), monitoramento reforçado, canal de suporte, critérios de saída do hypercare.
- `docs/go-live/desligamento-n8n.md`: ordem de desativação dos fluxos, período de convivência, backup final do N8N e critérios para desligar.

### T8 — Material de treinamento
- `docs/treinamento/`: roteiro de treinamento para editores (2 h), executores (30 min) e administradores (1 h30), com exercícios práticos baseados nos workflows reais da instituição e workflows de exemplo prontos para importar.

## Fora do escopo

Novas funcionalidades. Qualquer pedido novo vai para o backlog pós go-live em `docs/sprints.md`.

## Critérios de aceite

| # | Critério | Verificação |
|---|---|---|
| 1 | Nenhum achado crítico ou alto sem correção, cada um com teste de regressão | `plano-de-acao.md` + CI |
| 2 | Auditoria de dependências, Trivy e gitleaks sem achados críticos/altos não tratados | Relatório |
| 3 | Restore de backup executado com sucesso em homologação | Registro no runbook |
| 4 | Comparação em paralelo mostra equivalência dos workflows migrados (divergências explicadas) | `docs/migracao/comparacao.md` |
| 5 | Documentação de usuário, operação e SDK completa e revisada | Revisão humana |
| 6 | Checklist de go-live completo, com todos os itens técnicos marcados | `docs/go-live/checklist.md` |
| 7 | `pnpm smoke:prod` passa em homologação com a configuração de produção | Execução |
| 8 | Toda a suíte de testes verde | CI |

## Entrega

Código corrigido, toda a documentação acima e o relatório `docs/relatorios/sprint-12.md`, com uma seção final **"Prontidão para go-live"**: o que está pronto, o que depende de ação humana e os riscos remanescentes.

> 🚀 **Marco humano:** a decisão de go-live, o deploy em produção, o reteste do pentest e o treinamento são conduzidos pela equipe da instituição com base nesses artefatos.
