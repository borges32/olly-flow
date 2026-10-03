# Spec 013 — Hardening, documentação e go-live

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 4 — Hardening |
| **Depende de** | 012 |
| **Requisitos de produto** | PR-20, PR-17 (migração), todos (documentação) |
| **ADRs relacionadas** | Todas |

## Contexto e problema

Última etapa antes da produção. É preciso:
- eliminar as vulnerabilidades encontradas no pentest;
- documentar a plataforma para usuários, operação e desenvolvimento;
- concluir a migração da POC comparando os resultados com o N8N;
- preparar o go-live com um caminho de volta seguro.

> **Divisão de responsabilidades:** o agente de IA executa as tarefas técnicas e de documentação. Estas atividades são humanas, e o agente apenas prepara os materiais:
> - executar o deploy em produção;
> - conduzir o treinamento;
> - aprovar o go-live e os riscos aceitos;
> - fazer o reteste do pentest.

## Histórias de usuário

### HU-1 — Vulnerabilidades corrigidas (P1)

Como **segurança da informação**, quero que todo achado crítico ou alto seja corrigido e coberto por teste de regressão.

**Cenários de aceite:**
1. **Dado** um achado do pentest, **quando** é tratado, **então** existe um teste que o reproduz, a correção e o registro no plano de ação.
2. **Dado** um achado que não será corrigido, **quando** é registrado, **então** fica como "pendente de aprovação" para decisão humana, nunca como "risco aceito" pelo agente.

### HU-2 — Migração comprovada (P1)

Como **PO**, quero comparar automaticamente as execuções reais do N8N com o Olly Flow antes de desligar o N8N.

**Cenários de aceite:**
1. **Dado** execuções reais do N8N, **quando** rodo a comparação, **então** os nós com efeitos colaterais são simulados e recebo a equivalência por workflow, com as divergências explicadas.

### HU-3 — Documentação completa (P1)

Como **usuário, operador ou desenvolvedor**, quero guias claros para usar, operar e estender a plataforma.

### HU-4 — Go-live seguro (P1)

Como **gestão**, quero checklist, backup e restore testados, rollback com critérios objetivos e um plano de hypercare.

### HU-5 — Treinamento (P2)

Como **PO**, quero roteiros de treinamento por papel, com exercícios.

## Requisitos funcionais

- **FR-001**: Cada achado do pentest DEVE ter um teste de reprodução, a correção ou mitigação, e um registro no plano de ação (ID, severidade, status, teste, referência da mudança).
- **FR-002**: Os achados críticos e altos DEVEM ser corrigidos. Os médios DEVEM ser corrigidos ou ter a mitigação documentada para decisão humana. Os baixos vão para o backlog.
- **FR-003**: O agente NÃO DEVE marcar risco como aceito. DEVE usar "pendente de aprovação".
- **FR-004**: DEVEM ser executadas e registradas: auditoria de dependências (Node e Python), scan de imagens e busca de segredos no repositório.
- **FR-005**: Os cabeçalhos de segurança (CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors`), o CORS restrito e os cookies seguros DEVEM ser verificados.
- **FR-006**: A configuração de produção NÃO DEVE habilitar Swagger, *password grant* nem usuários de teste. Um teste DEVE validar isso.
- **FR-007**: DEVE existir documentação de usuário: primeiros passos, referência de todos os nós, expressões, agentes e MCP, guia para quem vem do N8N, FAQ.
- **FR-008**: DEVE existir documentação de operação: runbook (instalação, upgrade, rollback, escala, rotação de chaves, execuções presas, fila, resposta a alertas), backup e restore com teste executado em homologação, plano de rollback com critérios e guia do administrador.
- **FR-009**: DEVE existir um guia de criação de nós com um modelo completo e testado, e um guia de contribuição.
- **FR-010**: As pendências do relatório de migração DEVEM ser resolvidas ou encaminhadas para decisão humana.
- **FR-011**: DEVE existir uma ferramenta de comparação que reexecuta no Olly Flow as entradas reais do N8N, com os efeitos colaterais simulados, e gera o relatório de equivalência.
- **FR-012**: DEVEM existir os artefatos de go-live: checklist, valores de produção de referência sem segredos, smoke test de produção não destrutivo, plano de hypercare e plano de desligamento do N8N.
- **FR-013**: DEVEM existir roteiros de treinamento por papel, com exercícios e workflows de exemplo.

## Requisitos não funcionais

- **NFR-001**: O smoke test de produção não altera dados.

## Critérios de sucesso

- **SC-001**: Nenhum achado crítico ou alto sem correção e teste.
- **SC-002**: Auditorias e scans sem achados críticos ou altos não tratados.
- **SC-003**: Restore executado com sucesso em homologação.
- **SC-004**: A comparação mostra equivalência dos workflows migrados, com as divergências explicadas.
- **SC-005**: Documentação revisada por humano.
- **SC-006**: Checklist de go-live com os itens técnicos marcados.
- **SC-007**: O smoke de produção passa em homologação com a configuração de produção.

## Fora do escopo

Novas funcionalidades. Pedidos novos viram specs no backlog do roadmap.

## Pré-requisitos humanos

- Relatório do pentest em `docs/seguranca/pentest/`.
- Data e janela do go-live e responsáveis definidos.
- Acesso às execuções do N8N para a comparação.

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: duração do hypercare e canal de suporte oficial?] O padrão é 2–4 semanas.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 12 | Migração para SDD |
