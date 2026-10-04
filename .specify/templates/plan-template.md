# Plano técnico — Spec NNN: <Título>

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

<Em poucas linhas: como a spec será implementada.>

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| III — Segurança | <...> |
| IV — Testes | <...> |

<!-- Liste apenas os artigos relevantes. Qualquer exceção precisa de justificativa e aprovação humana. -->

## Componentes afetados

| Componente | Mudança |
|---|---|
| `apps/api` | <...> |

## Design

<Detalhe técnico por área: módulos, fluxos, algoritmos, parâmetros de nós.>

## Modelo de dados

<Migrations: tabelas, colunas, índices. Atualizar também docs/arquitetura/modelo-dados.md.>

## Contratos

<Endpoints (método, rota, permissão, entrada, saída), eventos WebSocket, parâmetros de nós, mensagens IPC.>

## Permissões RBAC

<Permissões que esta spec introduz ou usa, se já existem no catálogo/seed e quais papéis as recebem. Cada spec acrescenta as permissões que cria ao catálogo (`packages/shared-types/src/rbac.ts`), ao seed e a `docs/arquitetura/contratos.md`. Permissões exclusivas do admin entram também na lista de exclusões do editor.>

| Permissão | Situação no catálogo/seed | Papéis | O que esta spec faz |
|---|---|---|---|

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|

## Estratégia de testes

| Requisito | Tipo de teste | Arquivo/caso |
|---|---|---|
| FR-001 | Integração | <...> |

## Riscos

| Risco | Mitigação |
|---|---|

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
