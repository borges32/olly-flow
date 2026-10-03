# Spec 012 — Observabilidade, importador N8N e homologação

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 4 — Hardening |
| **Depende de** | 011 |
| **Requisitos de produto** | PR-17, PR-20, PR-07 (correlação) |
| **ADRs relacionadas** | 0001 (mapeamento do importador), 0006 |

## Contexto e problema

A plataforma está funcionalmente completa. Antes da produção, ela precisa:
- ser **operável**: métricas, traces, logs centralizados e alertas;
- ser **implantável** em homologação e produção;
- receber os workflows da POC por meio de um **importador** automático.

## Histórias de usuário

### HU-1 — Diagnosticar execuções (P1)

Como **operador da plataforma**, quero rastrear cada execução de ponta a ponta (trace por nó), ver métricas e receber alertas.

**Cenários de aceite:**
1. **Dado** uma execução, **quando** clico no link do trace, **então** vejo um span por nó no visualizador de traces.
2. **Dado** a fila crescendo por mais de 5 minutos, **quando** a regra avalia, **então** um alerta é disparado.

### HU-2 — Importar workflows do N8N (P1)

Como **editor**, quero importar workflows exportados do N8N e receber um relatório do que precisa de ajuste.

**Cenários de aceite:**
1. **Dado** um JSON exportado do N8N, **quando** importo em modo prévia, **então** vejo os nós convertidos, os com aviso, os não suportados, as expressões a revisar e as credenciais a cadastrar.
2. **Dado** uma importação confirmada, **quando** abro o workflow, **então** ele está como rascunho, com os nós não suportados destacados e desabilitados, e não pode ser publicado até serem resolvidos.

### HU-3 — Implantar em homologação (P1)

Como **equipe de infraestrutura**, quero pacotes de implantação versionados, seguros e com instruções de instalação, upgrade e rollback.

### HU-4 — Conhecer a capacidade (P2)

Como **PO**, quero medições de carga dos cenários principais para comparar com as metas.

### Casos de borda

- Nó do N8N em versão de tipo não mapeada: importado como não suportado, com o JSON original preservado.
- O mascaramento LGPD também vale para logs centralizados e traces.

## Requisitos funcionais

- **FR-001**: Cada execução DEVE gerar um trace com um span raiz e um span por nó (sem conteúdo de payload), propagado entre a API, o worker e os runners. O id do trace DEVE ser registrado e acessível pela UI.
- **FR-002**: Os serviços DEVEM expor métricas de execuções, duração, nós, fila, webhooks, sandbox, tokens de LLM e chamadas MCP, sem labels de alta cardinalidade em histogramas.
- **FR-003**: DEVEM existir dashboards e regras de alerta versionados: fila crescendo, taxa de erro, worker sem heartbeat e falhas do sandbox.
- **FR-004**: Os logs DEVEM ser estruturados, correlacionados ao trace e enviáveis ao SIEM institucional por configuração, com mascaramento aplicado.
- **FR-005**: O importador DEVE converter nós, conexões (por nome → por id, com portas mapeadas) e tipos conforme a tabela da ADR-0001, com um conversor por tipo de nó e versão.
- **FR-006**: As expressões DEVEM ser mantidas. As construções divergentes ou não suportadas DEVEM ser marcadas para revisão.
- **FR-007**: As credenciais NÃO DEVEM ser importadas. O importador DEVE listar as credenciais a cadastrar e os nós que as usam.
- **FR-008**: Os nós não suportados DEVEM ser importados como marcadores desabilitados, com o JSON original. A publicação DEVE ser bloqueada enquanto existirem.
- **FR-009**: O importador DEVE gerar um relatório de migração, suportar modo prévia e criar os workflows como rascunho no projeto escolhido.
- **FR-010**: Todos os workflows da POC DEVEM ser importados, com o relatório consolidado. Os sem pendências DEVEM ser executados contra a saída esperada.
- **FR-011**: DEVEM existir pacotes de implantação (Helm, ou o alvo definido pela ADR-0006) com:
  - escalonamento de workers;
  - segredos externos;
  - políticas de rede (runner Python sem saída);
  - contexto de segurança restritivo;
  - probes;
  - orçamento de interrupção;
  - migrations como etapa de upgrade.
- **FR-012**: Banco, Redis, cofre e storage DEVEM ser externos ao pacote e configuráveis.
- **FR-013**: DEVEM existir cenários de carga automatizados para: webhook assíncrono e síncrono, ramos paralelos + Merge, código JS por item, Python com pandas e agente com tools.
- **FR-014**: DEVE existir um documento de escopo do pentest, com superfícies de ataque, usuários de teste e exclusões.

## Requisitos não funcionais

- **NFR-001**: Instalação validada em cluster efêmero no CI (kind/k3d).
- **NFR-002**: Metas de carga conforme NFR-G08 (produto). Se não houver metas, as medições ficam registradas como baseline.

## Entidades-chave

- **Relatório de migração**, **Marcador de nó não suportado**, **Trace de execução**.

## Critérios de sucesso

- **SC-001**: Trace com span por nó acessível a partir da UI.
- **SC-002**: Dashboards e alertas carregados automaticamente no ambiente de observabilidade.
- **SC-003**: Nenhum payload ou segredo em traces, métricas ou logs (busca por valores sentinela).
- **SC-004**: 100% dos workflows da POC importados e relatório consolidado gerado.
- **SC-005**: As fixtures sem pendências reproduzem a saída esperada.
- **SC-006**: Instalação no cluster de CI saudável, com o smoke test passando.
- **SC-007**: A política de rede impede o runner Python de acessar a rede externa.
- **SC-008**: Os resultados dos 6 cenários de carga estão no relatório.

## Fora do escopo

Correção dos achados do pentest (spec 013), deploy em produção e treinamento.

## Pré-requisitos humanos

- ADR-0006 decidida e acesso à homologação.
- Todos os workflows da POC exportados em `fixtures/n8n/`.
- Pentest agendado; metas de carga definidas (NFR-G08).

## Pontos em aberto

- [PRECISA ESCLARECIMENTO: endpoint/formato do SIEM institucional para envio de logs?]
- [PRECISA ESCLARECIMENTO: metas de throughput e latência (NFR-G08)?]

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 11 | Migração para SDD |
