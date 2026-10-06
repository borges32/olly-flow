# Matriz RBAC

> **Gerado** por `apps/api/src/rbac/rbac-matrix.int.test.ts` (spec 005, FR-017), executando cada ação contra a API real com os papéis padrão do seed (`packages/shared-types/src/rbac.ts`). Não edite à mão: regenere com `OLLY_UPDATE_RBAC_MATRIX=1 pnpm --filter @olly/api test:integration`.

Papéis por projeto. "Admin da plataforma" é o grupo de administração do IdP (`OIDC_ADMIN_GROUP`), com todas as permissões em todos os projetos; um grupo do IdP mapeado para um papel global (spec 009) tem as permissões desse papel em todos os projetos. "Não membro" recebe 404 nos recursos do projeto. As ações marcadas com (global) só existem no escopo da plataforma: o papel admin de um projeto não as tem.

| Ação | Permissão | admin da plataforma | admin | editor | executor | viewer | não membro |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Ver workflows do projeto | `workflow:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Criar workflow | `workflow:create` | ✅ | ✅ | ✅ | — | — | — |
| Editar workflow | `workflow:update` | ✅ | ✅ | ✅ | — | — | — |
| Excluir workflow | `workflow:delete` | ✅ | ✅ | ✅ | — | — | — |
| Executar (teste) | `workflow:execute` | ✅ | ✅ | ✅ | ✅ | — | — |
| Publicar e despublicar | `workflow:publish` | ✅ | ✅ | ✅ | — | — | — |
| Ver execuções | `execution:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Ver dados das execuções | `execution:readData` | ✅ | ✅ | ✅ | — | — | — |
| Listar e usar credenciais | `credential:use` | ✅ | ✅ | ✅ | — | — | — |
| Gerenciar credenciais | `credential:manage` | ✅ | ✅ | ✅ | — | — | — |
| Gerenciar membros do projeto | `project:manage` | ✅ | ✅ | — | — | — | — |
| Ver histórico, versões e diff | `workflow:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Restaurar versão | `workflow:update` | ✅ | ✅ | ✅ | — | — | — |
| Aprovar pedido de publicação de outra pessoa | `workflow:publish` | ✅ | ✅ | ✅ | — | — | — |
| Ver dados das execuções (projeto com "Executor vê os dados") | `execution:readData` | ✅ | ✅ | ✅ | ✅ | — | — |
| Configurar governança e mascaramento do projeto | `project:manage` | ✅ | ✅ | — | — | — | — |
| Mapear grupos do IdP e gerenciar usuários (global) | `user:manage` | ✅ | — | — | — | — | — |
| Regras globais de mascaramento (global) | `project:manage` | ✅ | — | — | — | — | — |
| Consultar e exportar a auditoria (global) | `audit:read` | ✅ | — | — | — | — | — |
| Gerenciar o catálogo MCP (servidores, aprovação e políticas) (global) | `mcp:manage` | ✅ | — | — | — | — | — |
| Listar servidores MCP e tools liberadas (uso em workflows) | `credential:use` | ✅ | ✅ | ✅ | — | — | — |
| Ver as chamadas MCP de uma execução | `execution:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Ver os passos do agente e o uso de IA de uma execução | `execution:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Ver o uso e o custo de IA do projeto | `project:manage` | ✅ | ✅ | — | — | — | — |
| Ver o uso de IA da plataforma e editar a tabela de preços (global) | `project:manage` | ✅ | — | — | — | — | — |
| Cadastrar os modelos de IA permitidos na instalação (global) | `project:manage` | ✅ | — | — | — | — | — |
| Ver a configuração de IA do projeto | `workflow:read` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Alterar os modelos permitidos e o limite de tokens do projeto (global) | `project:manage` | ✅ | — | — | — | — | — |
| Listar os modelos de IA permitidos (nó Modelo de chat) | `credential:use` | ✅ | ✅ | ✅ | — | — | — |
| Aprovar ou rejeitar uma ação do agente | `workflow:execute` | ✅ | ✅ | ✅ | ✅ | — | — |

Spec 009: com a opção "Executor vê os dados das execuções" do projeto (`executor_can_read_data`), o papel Executor ganha `execution:readData` naquele projeto (FR-019). Com a aprovação de publicação ativa, publicar abre um pedido; o autor do pedido nunca o aprova (FR-011).

Spec 010: os argumentos (mascarados) das chamadas MCP só aparecem para quem tem `execution:readData`; os demais veem a chamada sem os argumentos.
