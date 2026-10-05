# Matriz RBAC

> **Gerado** por `apps/api/src/rbac/rbac-matrix.int.test.ts` (spec 005, FR-017), executando cada ação contra a API real com os papéis padrão do seed (`packages/shared-types/src/rbac.ts`). Não edite à mão: regenere com `OLLY_UPDATE_RBAC_MATRIX=1 pnpm --filter @olly/api test:integration`.

Papéis por projeto. O grupo de administração do IdP (`OIDC_ADMIN_GROUP`) tem todas as permissões em todos os projetos. "Não membro" recebe 404 nos recursos do projeto.

| Ação | Permissão | admin | editor | executor | viewer | não membro |
|---|---|:---:|:---:|:---:|:---:|:---:|
| Ver workflows do projeto | `workflow:read` | ✅ | ✅ | ✅ | ✅ | — |
| Criar workflow | `workflow:create` | ✅ | ✅ | — | — | — |
| Editar workflow | `workflow:update` | ✅ | ✅ | — | — | — |
| Excluir workflow | `workflow:delete` | ✅ | ✅ | — | — | — |
| Executar (teste) | `workflow:execute` | ✅ | ✅ | ✅ | — | — |
| Publicar e despublicar | `workflow:publish` | ✅ | ✅ | — | — | — |
| Ver execuções | `execution:read` | ✅ | ✅ | ✅ | ✅ | — |
| Ver dados das execuções | `execution:readData` | ✅ | ✅ | — | — | — |
| Listar e usar credenciais | `credential:use` | ✅ | ✅ | — | — | — |
| Gerenciar credenciais | `credential:manage` | ✅ | ✅ | — | — | — |
| Gerenciar membros do projeto | `project:manage` | ✅ | — | — | — | — |

Permissões sem rota até agora: `user:manage` (administração de usuários pelo IdP) e `audit:read` (consulta de auditoria, spec 009).
