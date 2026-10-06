# Spec 012 — Observabilidade (OpenTelemetry) e importador N8N

| Campo | Valor |
|---|---|
| **Status** | Em implementação |
| **Fase** | 4 — Hardening |
| **Depende de** | 011 |
| **Requisitos de produto** | PR-17, PR-20, PR-07 (correlação) |
| **ADRs relacionadas** | 0001 (mapeamento do importador) |

## Contexto e problema

A plataforma está funcionalmente completa. Antes da produção, ela precisa:
- ser **observável** pelas ferramentas da instituição: métricas, traces e logs no padrão **OpenTelemetry**, enviados a um **coletor OTel** (OTLP). A análise, os painéis e os alertas ficam nas ferramentas de observabilidade, não dentro da plataforma;
- receber os workflows da POC por meio de um **importador** automático.

## Histórias de usuário

### HU-1 — Diagnosticar execuções com OpenTelemetry (P1)

Como **operador da plataforma**, quero que a plataforma gere métricas, traces e logs no padrão OpenTelemetry e os envie ao coletor OTel da instituição, para diagnosticar execuções (de ponta a ponta, com um span por nó) nas ferramentas de observabilidade que já uso.

**Cenários de aceite:**
1. **Dado** o endereço do coletor OTel configurado, **quando** um workflow executa, **então** o coletor recebe um trace com um span raiz da execução e um span por nó, e o id do trace fica registrado na execução.
2. **Dado** o coletor configurado, **quando** a plataforma opera, **então** ele recebe as métricas (execuções, fila, nós etc.) e os logs estruturados correlacionados ao trace, todos por OTLP.
3. **Dado** que o coletor não está configurado ou está fora do ar, **quando** um workflow executa, **então** a execução não é afetada.

### HU-2 — Importar workflows do N8N (P1)

Como **editor**, quero importar workflows exportados do N8N e receber um relatório do que precisa de ajuste.

**Cenários de aceite:**
1. **Dado** um JSON exportado do N8N, **quando** importo em modo prévia, **então** vejo os nós convertidos, os com aviso, os não suportados, as expressões a revisar e as credenciais a cadastrar.
2. **Dado** uma importação confirmada, **quando** abro o workflow, **então** ele está como rascunho, com os nós não suportados destacados e desabilitados, e não pode ser publicado até serem resolvidos.

### Casos de borda

- Nó do N8N em versão de tipo não mapeada: importado como não suportado, com o JSON original preservado.
- O mascaramento LGPD também vale para os logs, traces e métricas enviados ao coletor.
- Coletor indisponível: a telemetria é descartada após o *buffer* limitado, sem travar nem falhar execuções.

## Requisitos funcionais

- **FR-001**: Cada execução DEVE gerar um trace OpenTelemetry com um span raiz e um span por nó (sem conteúdo de payload), propagado entre a API, o worker e os runners. O id do trace DEVE ser registrado na execução, para correlação.
- **FR-002**: Os serviços DEVEM gerar métricas OpenTelemetry de execuções, duração, nós, fila, webhooks, sandbox, tokens de LLM e chamadas MCP, sem atributos de alta cardinalidade em histogramas.
- **FR-003**: Os logs DEVEM ser estruturados e correlacionados ao trace (ids do trace e do span), com o mascaramento LGPD aplicado.
- **FR-004**: Traces, métricas e logs DEVEM ser enviados por OTLP a um coletor OpenTelemetry configurável (endereço, protocolo e cabeçalhos de autenticação), seguindo as variáveis padrão do OpenTelemetry. Sem coletor configurado, a telemetria fica desligada, e a falha do coletor NÃO DEVE afetar as execuções.
- **FR-005**: O importador DEVE converter nós, conexões (por nome → por id, com portas mapeadas) e tipos conforme a tabela da ADR-0001, com um conversor por tipo de nó e versão.
- **FR-006**: As expressões DEVEM ser mantidas. As construções divergentes ou não suportadas DEVEM ser marcadas para revisão.
- **FR-007**: As credenciais NÃO DEVEM ser importadas. O importador DEVE listar as credenciais a cadastrar e os nós que as usam.
- **FR-008**: Os nós não suportados DEVEM ser importados como marcadores desabilitados, com o JSON original. A publicação DEVE ser bloqueada enquanto existirem.
- **FR-009**: O importador DEVE gerar um relatório de migração, suportar modo prévia e criar os workflows como rascunho no projeto escolhido.
- **FR-010**: Todos os workflows da POC DEVEM ser importados, com o relatório consolidado. Os sem pendências DEVEM ser executados contra a saída esperada.
- **FR-011**: DEVE existir um documento de escopo do pentest, com superfícies de ataque, usuários de teste e exclusões.

## Requisitos não funcionais

- **NFR-001**: O envio de telemetria é assíncrono e em lote: o custo por nó executado não deve aumentar de forma perceptível a duração das execuções (medido no teste de integração com o coletor de teste).

## Entidades-chave

- **Relatório de migração**, **Marcador de nó não suportado**, **Trace de execução** (id registrado na execução).

## Critérios de sucesso

- **SC-001**: Um coletor OTel de teste recebe, de uma execução, o trace com span raiz e um span por nó, com o mesmo id registrado na execução.
- **SC-002**: O coletor de teste recebe as métricas e os logs correlacionados (com os ids do trace e do span) por OTLP.
- **SC-003**: Nenhum payload ou segredo em traces, métricas ou logs enviados (busca por valores sentinela).
- **SC-004**: 100% dos workflows da POC importados e relatório consolidado gerado.
- **SC-005**: As fixtures sem pendências reproduzem a saída esperada.
- **SC-006**: Com o coletor desligado ou inacessível, as execuções terminam normalmente.

## Fora do escopo

- Correção dos achados do pentest (spec 013), deploy em produção e treinamento.
- Painéis, alertas, armazenamento e visualização da telemetria: ficam nas ferramentas de observabilidade da instituição, alimentadas pelo coletor OTel.
- Pacotes de implantação (Helm etc.), instalação em cluster e testes de carga (removidos desta spec em 06/10/2026).

## Pré-requisitos humanos

- Endereço e forma de autenticação do coletor OTel institucional (para a validação fora dos testes, que usam um coletor local).
- Todos os workflows da POC exportados em `fixtures/n8n/`.
- Pentest agendado.

## Pontos em aberto

- Nenhum. (O envio ao SIEM deixou de ser desta spec: o coletor OTel da instituição encaminha os logs.)

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 11 | Migração para SDD |
| 06/10/2026 | HU-1 refeita: telemetria no padrão OpenTelemetry (traces, métricas, logs) enviada a um coletor OTel por OTLP, em vez de observabilidade na própria ferramenta (link do trace na UI, painéis e alertas versionados, envio direto ao SIEM). HU-3 (implantação em homologação) e HU-4 (capacidade) removidas, com FR-011 a FR-013, NFR-001, NFR-002, SC-006 a SC-008 e a ADR-0006; requisitos renumerados (FR-001 a FR-011) e NFR-001 nova (custo da telemetria); pontos em aberto do SIEM e das metas de carga encerrados | Decisão humana |
