# Relatório — Spec 016: Nós Bridge Chat Model e Agentix

**Status:** Não implementada (spec esclarecida, com plano e tarefas; implementação não iniciada)
**Data:** 07/10/2026

## Resumo

A spec foi escrita a partir da análise do projeto `Bridge-Chat-Model` (nós customizados do N8N). Os esclarecimentos do PO foram registrados no histórico da [spec](spec.md), e o [plano](plan.md) e as [tarefas](tasks.md) foram gerados. Nenhum código foi escrito. Este relatório será completado ao fim da implementação, conforme o AGENTS.md.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001–T002 | ❌ | Não iniciadas |
| T010–T011 | ❌ | Não iniciadas |
| T020–T023 | ❌ | Não iniciadas |
| T030–T031 | ❌ | Não iniciadas |
| T040 | ❌ | Não iniciada |
| T050–T051 | ❌ | Não iniciadas |
| T090–T093 | ❌ | Não iniciadas |

## Requisitos

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 a FR-015 | Não | Testes previstos no [plano](plan.md#estratégia-de-testes) |
| NFR-001 a NFR-003 | Não | Idem |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 a SC-005 | Pendente | Testes de unidade e de integração com os serviços simulados |
| SC-006 | Pendente | Validação manual em homologação (pré-requisito humano) |

## Comandos de verificação

Ainda não executados para esta spec: a implementação não começou.

## Decisões tomadas

Decisões do PO em 07/10/2026, registradas no histórico da spec:
- **Certificado TLS:** cada credencial permite desligar a verificação.
- **Endereços:** sem endereços padrão; o usuário informa todos.
- **Espera do Agentix:** dentro do nó, ocupando o worker, com o tempo limite padrão de 600 s configurável no nó.
- **Agentix como ferramenta do Agent:** fora do escopo.
- **Modelos da Bridge:** sem lista de modelos; o modelo é texto livre.

As decisões técnicas estão no [plano](plan.md#decisões-técnicas): nó próprio para a Bridge, mesmos nomes de credencial do N8N, token em memória por processo, TLS desligável sem perder o anti-SSRF.

## Desvios da spec/plano

Nenhum (implementação não iniciada).

## Dependências adicionadas

Nenhuma prevista: o plano usa o LangChain (`@langchain/openai`) e o `undici`, que já estão no projeto.

## Pendências, bloqueios e riscos

**Pré-requisitos humanos:**
- **ADR-0008:** decidir sobre a Bridge como provedor de LLM aprovado (a ADR cita OpenAI, Claude e Google).
- **Acessos:** homologação da Bridge (usuário de serviço) e do Agentix (chave), para o SC-006.
- **Rede:** liberação dos endereços internos na allowlist da instalação.
- **Fixtures:** workflows da POC com os dois nós, exportados em `fixtures/n8n/`.

**Riscos:**
- **Verificação TLS desligada:** aceito pelo PO; mitigações no [plano](plan.md#riscos).
- **Workers ocupados:** a espera do Agentix ocupa um worker durante a sessão.

## Como demonstrar

A definir ao fim da implementação.

## Próximos passos sugeridos

- Revisão humana do plano e das tarefas, para levar a spec a `Aprovada`.
- Depois da implementação: avaliar pausar a execução durante sessões longas do Agentix, se a ocupação de workers incomodar, e o Agentix como ferramenta do Agent, se surgir demanda.
