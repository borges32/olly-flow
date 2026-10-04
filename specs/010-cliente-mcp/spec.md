# Spec 010 — Cliente MCP

| Campo | Valor |
|---|---|
| **Status** | Aprovada |
| **Fase** | 3 — IA e governança |
| **Depende de** | 009 |
| **Requisitos de produto** | PR-14 |
| **ADRs relacionadas** | 0001 |

## Contexto e problema

Servidores MCP (Model Context Protocol) expõem *tools*, *resources* e *prompts* que workflows e agentes vão consumir. Esses servidores podem executar ações com efeitos reais e devolver conteúdo não confiável. Também podem alterar silenciosamente a descrição de uma tool (*tool poisoning*). Por isso, o acesso precisa ser governado:
- catálogo aprovado;
- tools liberadas explicitamente;
- detecção de mudanças;
- auditoria de cada chamada.

## Histórias de usuário

### HU-1 — Governar servidores MCP (P1)

Como **administrador**, quero cadastrar e aprovar servidores MCP e liberar tools específicas por projeto.

**Cenários de aceite:**
1. **Dado** um servidor cadastrado, **quando** testo a conexão, **então** vejo as capacidades e as tools disponíveis.
2. **Dado** uma tool não liberada, **quando** um workflow tenta usá-la, **então** a chamada é recusada e auditada.
3. **Dado** uma tool liberada cuja descrição ou schema mudou no servidor, **quando** um workflow a chama, **então** a chamada é bloqueada até eu revisar a mudança.

### HU-2 — Chamar tools MCP em workflows (P1)

Como **editor**, quero um nó Cliente MCP que liste e chame tools, leia resources e obtenha prompts, com o formulário gerado a partir do schema da tool.

**Cenários de aceite:**
1. **Dado** a tool `soma` liberada, **quando** a configuro com argumentos vindos de expressões, **então** recebo o resultado.
2. **Dado** argumentos inválidos para o schema, **quando** executo, **então** o erro ocorre antes da chamada.

### HU-3 — Servidores autenticados (P2)

Como **editor**, quero conectar servidores MCP que exigem token ou OAuth.

### Casos de borda

- Servidor MCP aponta para IP interno não liberado: bloqueado pelo anti-SSRF.
- A tool retorna `isError`: segue a configuração de erro do nó.
- Resultado muito grande: truncado ou recusado.

## Requisitos funcionais

- **FR-001**: O sistema DEVE manter um catálogo de servidores MCP (transporte, endereço ou imagem, credencial, escopo global ou por projeto, status, quem cadastrou e quem aprovou), gerenciado com a permissão `mcp:manage`.
- **FR-002**: Tools DEVEM ser negadas por padrão e liberadas explicitamente por servidor e projeto, com a marcação de destrutiva.
- **FR-003**: Ao aprovar um servidor, o sistema DEVE guardar um snapshot das tools (nome, descrição, schema). Mudanças em tools liberadas DEVEM bloquear as chamadas até nova revisão, exibindo o diff.
- **FR-004**: O cliente DEVE suportar os transportes Streamable HTTP (preferencial) e SSE (legado), ambos sujeitos ao anti-SSRF.
- **FR-005**: O transporte stdio DEVE ser permitido somente para servidores aprovados, executados em container isolado. O sistema NÃO DEVE executar processos stdio diretamente no worker.
- **FR-006**: O cliente DEVE reaproveitar as conexões, aplicar timeout e cancelamento por chamada e limitar o tamanho dos resultados.
- **FR-007**: O sistema DEVE suportar autenticação por token, por headers e por OAuth 2.1 conforme a especificação MCP, com tokens de atualização cifrados.
- **FR-008**: O nó `ai.mcpClient` DEVE oferecer as operações chamar tool, listar tools, ler resource, listar resources, obter prompt e listar prompts.
- **FR-009**: O formulário de argumentos DEVE ser gerado a partir do schema da tool, com expressões por campo e a alternativa de JSON livre. Os argumentos DEVEM ser validados antes da chamada.
- **FR-010**: Conteúdo binário retornado DEVE ser armazenado e referenciado no item. `isError` DEVE seguir a configuração de erro do nó.
- **FR-011**: Cada chamada MCP DEVE ser registrada (servidor, tool, argumentos mascarados, status, duração, tamanho, erro) e exibida na execução.
- **FR-012**: Chamadas a tools não permitidas DEVEM falhar com erro claro e ser auditadas.
- **FR-013**: DEVE existir um servidor MCP de teste (HTTP e stdio) para testes e demonstração.

## Requisitos não funcionais

- **NFR-001**: Timeout padrão de 60 s por chamada.
- **NFR-002**: Versão da especificação MCP adotada registrada no relatório.

## Entidades-chave

- **Servidor MCP**, **Política de tool**, **Snapshot de tools**, **Chamada MCP**.

## Critérios de sucesso

- **SC-001**: Chamada `soma` via HTTP e via stdio retorna o resultado.
- **SC-002**: Tool não liberada é recusada e auditada.
- **SC-003**: Mudança de schema bloqueia até a revisão.
- **SC-004**: Argumentos inválidos falham antes da chamada.
- **SC-005**: Servidor com IP interno não liberado é bloqueado.
- **SC-006**: OAuth conecta e renova o token.
- **SC-007**: Toda chamada aparece com argumentos mascarados.

## Fora do escopo

AI Agent e uso das tools por agentes (spec 011).

## Pré-requisitos humanos

- Lista dos servidores MCP internos que devem compor o catálogo inicial (desejável).

## Pontos em aberto

Nenhum.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 9 | Migração para SDD |
| 03/10/2026 | Permissões RBAC explicitadas no plano (seção e tarefa T089), sem mudança de requisito | Decisão humana sobre permissões por spec |
