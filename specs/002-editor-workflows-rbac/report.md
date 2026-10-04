# Relatório — Spec 002: Editor visual, workflows e RBAC por projeto

**Status:** Verificada
**Data:** 03/10/2026

## Resumo

- **RBAC por projeto com CASL:** guard, decorator com escopo, 404 para não membros e teste de cobertura de todas as rotas.
- **API:** projetos, membros e usuários; workflows versionados com concorrência otimista (409), validação estrutural (422 com os nós envolvidos) e auditoria de toda mudança.
- **`packages/engine`:** validação estrutural e motor sequencial.
- **Nós:** `trigger.manual` e `data.set`.
- **Editor visual (React Flow + Zustand):** paleta com busca, painel gerado pelo schema com `x-display-options`, desfazer/refazer, copiar/colar, atalhos, destaque de erros, diálogo de conflito e modo somente leitura. Inclui também as telas de workflows e de administração.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | `0002_workflows` (+ coluna `workflows.version` para a concorrência otimista) |
| T010 | ✅ | `AbilityFactory` (CASL 6.8), `@RequirePermission(permissão, escopo)`, `@RequireProjectMember`, `PermissionGuard`, `ResourceResolver` |
| T011 | ✅ | `apps/api/src/rbac/rbac-coverage.test.ts` (unidade; sobe a app sem banco) |
| T012 | ✅ | `AuditService.record(trx, ctx, entry)`, gravado na mesma transação da mudança |
| T013 | ✅ | |
| T014 | ✅ | |
| T015 | ✅ | |
| T020 | ✅ | |
| T021 | ✅ | |
| T022 | ✅ | `rbac.int.test.ts` |
| T030 | ✅ | |
| T031 | ✅ | |
| T032 | ✅ | |
| T033 | ✅ | Clique adiciona; arrastar da paleta para o canvas também |
| T034 | ✅ | Sem `x-widget: code|json` (ver "Desvios") |
| T035 | ✅ | |
| T036 | ✅ | |
| T037 | ✅ | Além de `editor.spec.ts` e `readonly.spec.ts`: `admin.spec.ts` e `performance.spec.ts` (NFR-001) |
| T040 | ✅ | |
| T090 | ✅ | A partir de estado limpo |
| T091 | ✅ | Tabelas abaixo |
| T092 | ✅ | `docs/nos/README.md`, `trigger.manual.md`, `data.set.md` |
| T093 | ✅ | |

## Requisitos

Os testes desta spec citam `spec 002` no título, porque os IDs `FR-001` a `FR-017` também existem na spec 001.

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001 | Sim | `apps/api/src/workflows/workflows.int.test.ts` › "FR-001: …" (criar, abrir, renomear, lista paginada com busca, soft delete) |
| FR-002 | Sim | `workflows.int.test.ts` › "FR-001/FR-002: … nova versão com a definição completa" |
| FR-003 | Sim | `workflows.int.test.ts` › "FR-003/SC-006 …", "salvamentos simultâneos…"; `apps/web/e2e/editor.spec.ts` › "FR-003/HU-1.2 …" |
| FR-004 | Sim | `packages/engine/src/validate.test.ts`; `workflows.int.test.ts` › "FR-004/FR-005 …" |
| FR-005 | Sim | `validate.test.ts`; `workflows.int.test.ts` (422 com `nodeIds`); `editor.spec.ts` › "FR-005/HU-1.3: ciclo ao salvar destaca os nós envolvidos" |
| FR-006 | Sim | `workflows.int.test.ts` › "FR-006: …" |
| FR-007 | Sim | `editor.spec.ts` › "SC-001/FR-007/FR-009 …" (paleta com busca e categorias, conectar), "FR-008 …" (zoom, enquadrar, minimapa); `apps/web/src/editor/store.test.ts` |
| FR-008 | Sim | `editor.spec.ts` › "FR-008 …"; `apps/web/src/editor/store.test.ts`; `apps/web/src/editor/graph.test.ts` |
| FR-009 | Sim | `editor.spec.ts` › "SC-001/FR-007/FR-009 …"; `apps/web/src/editor/schema-form-logic.test.ts` (`x-display-options`) |
| FR-010 | Sim | `apps/api/src/rbac/rbac.int.test.ts` › "FR-010: …"; `apps/web/src/lib/permissions.test.ts` |
| FR-011 | Sim | `rbac.int.test.ts` › "FR-011: …" (7 rotas, inexistente, id inválido, membro removido) |
| FR-012 | Sim | `apps/api/src/rbac/rbac-coverage.test.ts` |
| FR-013 | Sim | `rbac.int.test.ts` › "FR-013: …"; `apps/web/e2e/admin.spec.ts` |
| FR-014 | Sim | `apps/api/src/audit/audit.int.test.ts` |
| FR-015 | Sim | `apps/web/e2e/readonly.spec.ts` |
| FR-016 | Sim | `packages/engine/src/engine.test.ts` |
| FR-017 | Sim | `packages/nodes/src/trigger/manual/manual.test.ts`; `engine.test.ts` |
| FR-018 | Sim | `packages/nodes/src/data/set/set.test.ts` |
| NFR-001 | Sim | `apps/web/e2e/performance.spec.ts`: 100 nós, arraste medido por `requestAnimationFrame`: **47 a 60 fps** (Chromium headless, 4 execuções); meta ≥ 30 |
| NFR-002 | Sim | UI: `permissions.test.ts`, `readonly.spec.ts`, `admin.spec.ts`; API: `rbac.int.test.ts` (403/404 independentes da UI) |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `editor.spec.ts` › "SC-001/FR-007/FR-009 …": cria `Manual → Set` (campo `cliente.nome`), salva com Ctrl+S, recarrega e compara posições, conexão e parâmetros |
| SC-002 | ✅ | `readonly.spec.ts` (canvas somente leitura e PUT do visualizador = 403); `rbac.int.test.ts` |
| SC-003 | ✅ | `rbac.int.test.ts` › "FR-011: não membro → 404 …" |
| SC-004 | ✅ | `rbac-coverage.test.ts` |
| SC-005 | ✅ | `engine.test.ts` › "SC-005: executa Manual → Set com campo aninhado …" |
| SC-006 | ✅ | `workflows.int.test.ts` › "FR-003/SC-006 …" |

## Comandos de verificação

Executados em 03/10/2026 a partir de estado limpo (sem `node_modules`, `dist`, cache do Turbo e volumes), com o compose iniciado pelo próprio `pnpm test:e2e`.

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` | ✅ (0 erros, 0 avisos) |
| `pnpm typecheck` | ✅ |
| `pnpm test` | ✅ 137 testes (shared-types 12, nodes 21, engine 20, api 10, web 30, repositório 44) |
| `pnpm test:integration` | ✅ 70 testes (db 12, api 58) |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 12 testes (4 da spec 001 + 8 da spec 002) |
| `docker compose up -d && pnpm smoke` | ✅ |
| `pnpm audit --audit-level=high` | ✅ 0 altas; as mesmas 3 moderadas da spec 001 |

## Decisões tomadas

1. **Spec 001 marcada como `Verificada`.** O status foi alterado para "Validado" pelo revisor; alinhei ao vocabulário do processo (`Verificada`) na spec e no roadmap.
2. **Catálogo de permissões do seed (pendência da spec 001) não foi respondido.** Mantive a interpretação registrada lá: o editor tem `credential:*`, `workflow:publish` e `execution:readData`, e `mcp:manage` fica para a spec 010.
3. **Grupos do IdP deixam de conceder papéis**, exceto o grupo de administração. É o que diz o plan §1. Consequência: `editor@olly.local` sem projeto não vê workflows. O mapeamento de grupos para papéis por projeto é a spec 009.
4. **Escopo explícito no decorator:** `@RequirePermission(permissão | permissões, escopo)`, com escopo `{ project }`, `{ workflow }`, `'global'` ou `'anyProject'`. Isso evita que o guard adivinhe o significado de `:id`. O teste de cobertura verifica que o parâmetro do escopo existe na rota.
5. **Semântica de acesso:** recurso inexistente, id inválido ou projeto do qual o usuário não é membro → 404; membro sem a permissão → 403.
6. **Permissões por projeto sem cache:** uma consulta por requisição. Mudar papéis ou remover membros vale imediatamente.
7. **Concorrência otimista atômica:** `UPDATE workflows SET version = version + 1 WHERE id = ? AND version = baseVersion`. Nenhuma linha afetada → 409. O teste com 3 salvamentos simultâneos confirma que só um vence.
8. **Motor sequencial:**
   - executa a partir de um único gatilho (ou do nó indicado);
   - nós não alcançáveis não executam;
   - ramo sem itens fica `skipped` e propaga "sem dados";
   - o primeiro erro interrompe a execução (retry e `onError` chegam nas specs 004 e 007);
   - cada destino recebe uma cópia dos itens.
9. **`data.set`:** os valores são texto convertidos pelo tipo, com erro que cita o campo; a notação de ponto usa `lodash-es` (`set`), como no N8N. Detalhes em `docs/nos/data.set.md`.
10. **Editor:**
    - o histórico de desfazer agrupa digitação seguida no mesmo campo e registra o estado no início de cada arraste;
    - colar desloca 40 px e numera nomes repetidos no estilo do N8N (`Definir campos1`);
    - ao selecionar ou colar um nó fora da área visível, a vista o centraliza;
    - o nome do workflow é renomeado no próprio editor e salvo com a definição.
11. **Auditoria sem definição completa:** `details` registra versão, nome e número de nós, e não o JSON do workflow. As versões completas já ficam em `workflow_versions`.

## Desvios da spec/plano

| Desvio | Motivo | Documento atualizado |
|---|---|---|
| `x-widget: code|json` (Monaco) não implementado | Nenhum nó desta spec usa o widget; constituição, Art. IX.2. Fica para a spec do primeiro nó que precisar dele (003 ou 005) | `plan.md` §7 + Histórico |
| `OIDC_ADMIN_GROUP` (padrão `admin`) no lugar do nome fixo `admin` | O grupo institucional depende da ADR-0005 (Art. VI) | `plan.md` §1 + Histórico; `.env.example`; `contratos.md` |
| `@RequireProjectMember` e `@Authenticated` aceitos pela cobertura | `/me`, `/node-types` e `GET /projects` não exigem permissão específica, mas precisam declarar o acesso (Art. III.4) | `plan.md` §1 + Histórico |
| Erros `NODE_UNKNOWN_TYPE` e `DUPLICATE_NODE_ID`; 400 para corpo fora do schema | Pré-condições da validação de portas e da identificação dos nós | `plan.md` §3 + Histórico |
| `DELETE /projects/:id` com workflows → 409; coluna `workflows.version` | Preservar o histórico; concorrência atômica | `plan.md` §2 e Modelo de dados; `modelo-dados.md` |
| `/me` muda de formato (`permissions: { global, projects }`) | Previsto no plan §1 | `contratos.md`; testes da spec 001 ajustados (abaixo) |

**Ajustes em artefatos da spec 001** (consequência prevista no plan §1, sem mudança de comportamento da 001 além do `/me`):
- `auth.int.test.ts` › "FR-006" passa a esperar o novo formato;
- o E2E de login confere a lista de projetos em vez das permissões;
- o smoke lê `permissions.global`;
- `route-coverage.int.test.ts` foi substituído por `rbac/rbac-coverage.test.ts`, que cobre também `@RequirePermission`.

## Dependências adicionadas

| Pacote | Versão | Motivo | Licença |
|---|---|---|---|
| `@casl/ability` | 6.8.1 | Stack (autorização). Usei a major 6, conhecida e estável; a 7 saiu em 2026 | MIT |
| `@xyflow/react` | 12.12.0 | Stack (canvas) | MIT |
| `zustand` | 5.0.15 | Stack (estado do editor) | MIT |
| `@radix-ui/react-dialog` | 1.1.23 | Componente Dialog do shadcn/ui (novo workflow, exclusão, conflito 409) | MIT |
| `lodash-es`, `@types/lodash-es` | 4.18.1 / 4.17.12 | `set` com notação de ponto no `data.set` (plan §5), mesma semântica do N8N | MIT |

Novos workspaces internos: `@olly/engine`; `@olly/nodes` passou a ser dependência da API e (só tipos) do frontend.

## Pendências, bloqueios e riscos

- **Usuário só pode ser adicionado a um projeto depois do primeiro login** (a tabela `users` é alimentada pelo IdP no login). A sincronização de grupos e diretório é escopo da spec 009.
- **Pré-requisito humano da 002–005:** validar a UX do editor com usuários da POC (roadmap).
- **Validação só ao salvar:** o editor não valida em tempo real; erros e avisos aparecem após o salvamento.
- **Pendências herdadas da 001 sem mudança:** plataforma de CI, proteção de branch, CI nunca executado no GitHub, fixtures da POC, 3 vulnerabilidades moderadas em ferramentas de teste.
- **NFR-001** foi medido no Chromium headless da máquina de desenvolvimento; em máquinas mais fracas, vale repetir `performance.spec.ts`.

## Como demonstrar

```bash
docker compose up -d --wait
pnpm build && pnpm db:migrate && pnpm db:seed
pnpm dev
```

1. Faça login uma vez com `editor@olly.local` e com `viewer@olly.local` (para existirem na plataforma) e saia.
2. Faça login como `admin@olly.local` → **Administração** → crie um projeto e adicione `editor@olly.local` (Editor) e `viewer@olly.local` (Visualizador).
3. Entre como editor → **Workflows** → **Novo workflow**:
   - adicione **Gatilho manual** e **Definir campos** pela paleta e conecte os dois;
   - no painel do nó, adicione o campo `cliente.nome` = `Ana`;
   - salve com Ctrl+S e recarregue a página.
4. Teste Ctrl+C/Ctrl+V (nome `Definir campos1`), Delete, Ctrl+Z, Ctrl+Shift+Z e o indicador "Alterações não salvas".
5. Crie um ciclo entre dois nós `Definir campos` e salve: os nós ficam destacados e o painel de problemas mostra "Ciclo".
6. Entre como visualizador: o canvas fica somente leitura, sem paleta e sem botão Salvar.
7. API: `GET /api/v1/projects/:id` com um usuário de fora do projeto → 404. A auditoria fica em `SELECT action, details FROM audit_log ORDER BY id`.

## Próximos passos sugeridos

- Spec 003: execução de teste pela UI, usando `runWorkflow` e os callbacks já expostos pelo motor.
- Validação estrutural em tempo real no editor, reaproveitando `validateWorkflow` do `@olly/engine` no navegador.
- Convite de usuários antes do primeiro login, ou sincronização com o diretório (spec 009).
- Diff entre versões (`GET /workflows/:id/versions` já lista o histórico; previsto na spec 009).
