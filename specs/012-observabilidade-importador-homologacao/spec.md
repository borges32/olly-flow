# Spec 012 — Observabilidade (OpenTelemetry) e escopo do pentest

| Campo | Valor |
|---|---|
| **Status** | Em implementação |
| **Fase** | 4 — Hardening |
| **Depende de** | 011 |
| **Requisitos de produto** | PR-20, PR-07 (correlação) |
| **ADRs relacionadas** | — (o importador da ADR-0001 passou para a spec 015) |

## Contexto e problema

A plataforma está funcionalmente completa. Antes da produção, ela precisa:
- ser **observável** pelas ferramentas da instituição: métricas, traces e logs no padrão **OpenTelemetry**, enviados a um **coletor OTel** (OTLP). A análise, os painéis e os alertas ficam nas ferramentas de observabilidade, não dentro da plataforma;
- ter o escopo do pentest documentado.

O importador de workflows do N8N, antes nesta spec (HU-2), passou para a [spec 015](../015-exportar-importar-json/spec.md).

## Histórias de usuário

### HU-1 — Diagnosticar execuções com OpenTelemetry (P1)

Como **operador da plataforma**, quero que a plataforma gere métricas, traces e logs no padrão OpenTelemetry e os envie ao coletor OTel da instituição, para diagnosticar execuções (de ponta a ponta, com um span por nó) nas ferramentas de observabilidade que já uso.

**Cenários de aceite:**
1. **Dado** o endereço do coletor OTel configurado, **quando** um workflow executa, **então** o coletor recebe um trace com um span raiz da execução e um span por nó, e o id do trace fica registrado na execução.
2. **Dado** o coletor configurado, **quando** a plataforma opera, **então** ele recebe as métricas (execuções, fila, nós etc.) e os logs estruturados correlacionados ao trace, todos por OTLP.
3. **Dado** que o coletor não está configurado ou está fora do ar, **quando** um workflow executa, **então** a execução não é afetada.

### Casos de borda

- O mascaramento LGPD também vale para os logs, traces e métricas enviados ao coletor.
- Coletor indisponível: a telemetria é descartada após o *buffer* limitado, sem travar nem falhar execuções.

## Requisitos funcionais

- **FR-001**: Cada execução DEVE gerar um trace OpenTelemetry com um span raiz e um span por nó (sem conteúdo de payload), propagado entre a API, o worker e os runners. O id do trace DEVE ser registrado na execução, para correlação.
- **FR-002**: Os serviços DEVEM gerar métricas OpenTelemetry de execuções, duração, nós, fila, webhooks, sandbox, tokens de LLM e chamadas MCP, sem atributos de alta cardinalidade em histogramas.
- **FR-003**: Os logs DEVEM ser estruturados e correlacionados ao trace (ids do trace e do span), com o mascaramento LGPD aplicado.
- **FR-004**: Traces, métricas e logs DEVEM ser enviados por OTLP a um coletor OpenTelemetry configurável (endereço, protocolo e cabeçalhos de autenticação), seguindo as variáveis padrão do OpenTelemetry. Sem coletor configurado, a telemetria fica desligada, e a falha do coletor NÃO DEVE afetar as execuções.
- **FR-011** (FR-005 a FR-010 passaram para a spec 015): DEVE existir um documento de escopo do pentest, com superfícies de ataque, usuários de teste e exclusões.

## Requisitos não funcionais

- **NFR-001**: O envio de telemetria é assíncrono e em lote: o custo por nó executado não deve aumentar de forma perceptível a duração das execuções (medido no teste de integração com o coletor de teste).

## Entidades-chave

- **Trace de execução** (id registrado na execução).

## Critérios de sucesso

- **SC-001**: Um coletor OTel de teste recebe, de uma execução, o trace com span raiz e um span por nó, com o mesmo id registrado na execução.
- **SC-002**: O coletor de teste recebe as métricas e os logs correlacionados (com os ids do trace e do span) por OTLP.
- **SC-003**: Nenhum payload ou segredo em traces, métricas ou logs enviados (busca por valores sentinela).
- **SC-006**: Com o coletor desligado ou inacessível, as execuções terminam normalmente.

## Fora do escopo

- Correção dos achados do pentest (spec 013), deploy em produção e treinamento.
- Painéis, alertas, armazenamento e visualização da telemetria: ficam nas ferramentas de observabilidade da instituição, alimentadas pelo coletor OTel.
- Pacotes de implantação (Helm etc.), instalação em cluster e testes de carga (removidos desta spec em 06/10/2026).

## Pré-requisitos humanos

- Endereço e forma de autenticação do coletor OTel institucional (para a validação fora dos testes, que usam um coletor local).
- Pentest agendado.

## Pontos em aberto

- Nenhum. (O envio ao SIEM deixou de ser desta spec: o coletor OTel da instituição encaminha os logs.)

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 11 | Migração para SDD |
| 06/10/2026 | HU-1 refeita: telemetria no padrão OpenTelemetry (traces, métricas, logs) enviada a um coletor OTel por OTLP, em vez de observabilidade na própria ferramenta (link do trace na UI, painéis e alertas versionados, envio direto ao SIEM). HU-3 (implantação em homologação) e HU-4 (capacidade) removidas, com FR-011 a FR-013, NFR-001, NFR-002, SC-006 a SC-008 e a ADR-0006; requisitos renumerados (FR-001 a FR-011) e NFR-001 nova (custo da telemetria); pontos em aberto do SIEM e das metas de carga encerrados | Decisão humana |
| 07/10/2026 | HU-2 (importador do N8N), FR-005 a FR-010, SC-004, SC-005 e o caso de borda do importador passaram para a [spec 015](../015-exportar-importar-json/spec.md) (HU-3, FR-023 a FR-027, SC-007, SC-008); os ids restantes foram mantidos | Decisão humana: uma única tela de importação para o formato do Olly Flow e o do N8N |
