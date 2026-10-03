# Registro de Decisões de Arquitetura (ADR)

Cada decisão segue o formato **Contexto → Decisão → Consequências**.

**Status possíveis:** `Proposta` · `Aceita` · `Substituída` · `Rejeitada`.

- **ADR `Aceita`:** vinculante para todas as specs.
- **ADR `Proposta`:** é o padrão a seguir até ser decidida. O agente de IA **não** decide ADRs institucionais (ver [constituição](../../.specify/memory/constitution.md), Artigo VI).

| ADR | Título | Status | Decidir até | Afeta specs |
|---|---|---|---|---|
| [0001](0001-abordagem-hibrida.md) | Abordagem híbrida: plataforma própria compatível com o N8N | **Aceita** (02/10/2026) | — | Todas |
| [0002](0002-backend-node-nestjs.md) | Backend em Node.js + TypeScript com NestJS | Proposta | Início da 001 | Todas |
| [0003](0003-sandbox-javascript.md) | Sandbox JavaScript com isolated-vm em task runner separado | Proposta | Início da 001 | 003, 005 |
| [0004](0004-runner-python.md) | Runner Python em container isolado | Proposta | Início da 001 | 008 |
| [0005](0005-autenticacao-oidc.md) | Autenticação via OIDC federado ao diretório institucional | Proposta — institucional | 009 | 001, 009 |
| [0006](0006-infraestrutura.md) | Infraestrutura de execução | Proposta — institucional | 006 / 012 | 006, 012 |
| [0007](0007-gestao-de-segredos.md) | Gestão de segredos | Proposta — institucional | 009 | 004, 009 |
| [0008](0008-provedor-llm.md) | Provedor de LLM e camada de IA | Proposta — institucional | 011 | 011 |

## Como registrar uma nova ADR

1. Copie a estrutura de uma ADR existente para `NNNN-titulo-curto.md`, usando o próximo número.
2. Status inicial `Proposta`. Uma ADR proposta durante a implementação deve ser citada no `report.md` da spec.
3. Ao aceitar, substituir ou rejeitar, atualize o status no arquivo e nesta tabela.
