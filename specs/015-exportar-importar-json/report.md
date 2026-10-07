# Relatório — Spec 015: Exportar e importar workflows em JSON (formato do Olly Flow e do N8N)

**Status:** Implementada com pendências (SC-004 com um modelo de IA aprovado; workflows reais da POC)
**Data:** 07/10/2026

## Resumo

- **Baixar** o workflow em JSON pelo editor (o canvas, mesmo sem salvar) e pela lista (o rascunho salvo):
  - só Editor e Admin do projeto, com auditoria;
  - estrutura do N8N com os tipos e parâmetros do Olly Flow;
  - credenciais só referenciadas, dados fixados sempre incluídos.
- **Importar** um JSON (arquivo ou texto), escolhendo o formato **Olly Flow** ou **N8N**:
  - se o arquivo for de um workflow que já existe no projeto (o mesmo id ou, sem ele, o mesmo nome único), **sobrepõe o rascunho** dele como nova versão; senão, cria um rascunho novo;
  - prévia com erros, pendências e, no N8N, o relatório de migração;
  - credenciais ligadas pelo id ou pelo nome e tipo, nunca criadas;
  - tipos desconhecidos viram **nós marcadores** desabilitados, que bloqueiam a publicação.
- **Copiar e colar** nós como JSON no mesmo formato (Ctrl+C/Ctrl+V), inclusive JSON gerado fora da plataforma.
- **Documentação para modelos de IA** ([docs/nos/workflow-json.md](../../docs/nos/workflow-json.md)), verificada por teste: todos os tipos documentados e os exemplos importáveis.
- O **importador do N8N** (HU-2 da spec 012) foi absorvido.

## Tarefas

| ID | Status | Observação |
|---|---|---|
| T001 | ✅ | Spec 012 atualizada (HU-2, FR-005 a FR-010, SC-004 e SC-005 movidos); esclarecimentos no histórico da 015 |
| T002 | ✅ | `OLLY_IMPORT_MAX_BYTES`, `OLLY_IMPORT_MAX_NODES`, `OLLY_IMPORT_MAX_DEPTH` (`config.ts`, `.env.example`) |
| T010 | ✅ | `DynamicPorts` `placeholder` (`ports.ts`) e `packages/nodes/src/flow/placeholder/` |
| T011 | ✅ | Motor: sub-nó pelas portas efetivas; `unsupportedNodeIssues`; publicação bloqueada (`publishing.service.ts`) |
| T012 | ✅ | `packages/shared-types/src/workflow-file.ts` |
| T020–T021 | ✅ | `apps/api/src/workflow-io/` (`GET`/`POST /workflows/:id/export`) |
| T030–T032 | ✅ | Prévia e importação; pendências de referência; ida e volta com todos os tipos |
| T033 | ✅ | Sobrepor o workflow existente (§3.2): `findTarget` pelo id e pelo nome único, aviso de workflow publicado, `workflow:update`, auditoria com `overwritten` |
| T040–T042 | ✅ | `apps/api/src/workflow-io/n8n/` (conversores, conexões, credenciais, expressões, relatório); fixtures com o relatório consolidado em `docs/migracao/relatorio-fixtures-n8n.md` |
| T050–T053 | ✅ | Diálogo "Importar" e "Baixar" na lista; "Baixar" no editor; área de transferência; visual do marcador |
| T054 | ✅ | `apps/web/e2e/workflow-io.spec.ts` |
| T055 | ✅ | Aviso "Vai sobrepor" e botão "Importar e sobrepor" no diálogo; cenário E2E |
| T060–T061 | ✅ | `docs/nos/workflow-json.md` atualizado; `docs/nos/placeholder.unsupported.md`; `docs/importacao-n8n.md`; `docs.test.ts` |
| T090 | ✅ | Ver "Comandos de verificação" |
| T091 | ✅ | Tabelas abaixo |
| T092 | ✅ | README dos nós, contratos, matriz RBAC, nota na ADR-0001, índice de `docs/`, visão (rastreabilidade), roadmap |
| T093 | ✅ | Este relatório; status em `spec.md` e `docs/roadmap.md` |

## Requisitos

Caminhos usados na tabela:

| Abreviação | Arquivo |
|---|---|
| `file` | `packages/shared-types/src/workflow-file.test.ts` |
| `io` | `apps/api/src/workflow-io/workflow-io.int.test.ts` |
| `n8n` | `apps/api/src/workflow-io/n8n/n8n.test.ts` |
| `web` | `apps/web/src/editor/workflow-file-io.test.ts` |
| `e2e` | `apps/web/e2e/workflow-io.spec.ts` |

| Requisito | Atendido | Teste que comprova |
|---|---|---|
| FR-001, FR-002 | Sim | `file` › "FR-001/FR-002" |
| FR-003 | Sim | `file` › "FR-003"; `apps/api/src/workflow-io/round-trip.test.ts` › "NFR-001/SC-001/FR-003" |
| FR-004 | Sim | `file` › "FR-004" (exportação) e "FR-009/FR-004" (importação) |
| FR-005 | Sim | `file` › "FR-005" (2 testes) |
| FR-006 | Sim | `io` › "FR-006/FR-007/FR-009/SC-002", "FR-006: exporta o canvas"; `e2e` › "FR-006/FR-008" |
| FR-007 | Sim | `file` › "FR-007"; `io` › "FR-006/FR-007/FR-009/SC-002" |
| FR-008 | Sim | `io` › "FR-008"; `rbac-matrix.int.test.ts` ("Baixar workflow em JSON") |
| FR-009 | Sim | `file` › "FR-009"; `io` › "FR-006/FR-007/FR-009/SC-002" |
| FR-010, FR-011 | Sim | `io` › "FR-010/FR-011/FR-014/FR-017", "FR-011/FR-012/SC-005"; `e2e` › "FR-010/FR-011/FR-016" |
| FR-012 | Sim | `file` › "FR-012"; `io` › "FR-011/FR-012/SC-005" |
| FR-013 | Sim | `file` › "FR-013"; `io` › "FR-013" |
| FR-014 | Sim | `file` › "FR-014"; `io` › "FR-010/FR-011/FR-014/FR-017" |
| FR-015 | Sim | `io` › "FR-015" (workflow chamado, workflow de erro retirado, MCP, modelo, caminho do webhook) |
| FR-016 | Sim | `file` › "FR-016"; `packages/nodes/src/flow/placeholder/placeholder.test.ts`; `packages/engine/src/placeholder.test.ts`; `io` › "FR-016" (publicação 422); `e2e` |
| FR-017 | Sim | `io` › "FR-017", auditoria em "FR-010/…/FR-017"; `rbac-matrix.int.test.ts` ("Importar workflow em JSON") |
| FR-018 | Sim | `file` › "FR-018/SC-005"; `io` › "FR-011/FR-012/SC-005" (`__proto__`) |
| FR-019 | Sim | `file` › "FR-019"; `web` › "FR-019"; `e2e` › "FR-019/FR-020/SC-006" |
| FR-020 | Sim | `file` › "FR-020"; `web` › "FR-020/SC-006"; `e2e` › "FR-019/FR-020/SC-006" |
| FR-021, FR-022 | Sim | `apps/api/src/workflow-io/docs.test.ts` |
| FR-023 | Sim | `n8n` › "FR-023" (6 testes); `io` › "FR-010/FR-023/FR-026" |
| FR-024 | Sim | `n8n` › "FR-024" |
| FR-025 | Sim | `n8n` › "FR-025", "HTTP Request v4" (credenciais a cadastrar) |
| FR-026 | Sim | `n8n` › "FR-016/FR-026"; `io` › "FR-010/FR-023/FR-026"; `e2e` › "HU-3/FR-026" |
| FR-027 | Sim | `apps/api/src/workflow-io/n8n-fixtures.int.test.ts` |
| FR-028 (e FR-010, sobrepor) | Sim | `io` › "FR-028" (3 testes: pelo id, pelo nome e nome repetido, publicado e outro projeto); `e2e` › "FR-010/FR-028" |
| NFR-001 | Sim | `file` › "NFR-001/SC-001"; `round-trip.test.ts` (todos os tipos) |
| NFR-002 | Sim | `io` › "NFR-002" (413 citando `OLLY_IMPORT_MAX_BYTES`; limite de nós) |
| NFR-003 | Sim | `io` › sentinela no arquivo e na auditoria. A exportação e a importação não registram o conteúdo em logs |
| NFR-004 | Sim | `io` › "NFR-004" (200 nós) |

## Critérios de sucesso

| Critério | Resultado | Como verificar |
|---|---|---|
| SC-001 | ✅ | `round-trip.test.ts` (todos os tipos) e `io` (outro projeto) |
| SC-002 | ✅ | `io` (sentinela no arquivo e na auditoria); `web` (área de transferência só com a referência) |
| SC-003 | ✅ | `docs.test.ts` (7 exemplos, todos os tipos documentados) |
| SC-004 | ⚠️ | Validação humana com um modelo de IA aprovado (ADR-0008) e os 10 pedidos de referência (pré-requisito) |
| SC-005 | ✅ | `file` › "FR-018/SC-005"; `io` › "FR-011/FR-012/SC-005" |
| SC-006 | ✅ | `web` › "FR-020/SC-006"; `e2e` |
| SC-007 | ✅ (sintéticas) | `n8n-fixtures.int.test.ts`: 2 de 2 importadas ([relatório](../../docs/migracao/relatorio-fixtures-n8n.md)). Os workflows reais da POC ainda não foram exportados |
| SC-008 | ✅ (sintéticas) | `n8n-fixtures.int.test.ts`: as 2 fixtures reproduzem a saída esperada |

## Comandos de verificação

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm lint` / `pnpm typecheck` / prettier | ✅ |
| `pnpm test` | ✅ 600 testes. O teste de desempenho NFR-002 da spec 003 (`expressions/sandbox.test.ts`, meta < 1 s) falhou com a máquina carregada (1,28 s, 1,0 s, 1,45 s e 1,13 s em rodadas diferentes) e passou com a carga normal (985 ms e 754 ms). Ele não foi alterado, e a instabilidade já constava nos relatórios das specs 009 e 010 |
| `pnpm test:integration` | ✅ 347 testes (api 293, db 28, nodes 23, engine 3). Na primeira entrega, a lista exata de tipos de nó da spec 002 precisou incluir `placeholder.unsupported` |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 44 cenários (5 novos) |
| `pnpm app:up && pnpm smoke` | ✅ |
| `pnpm audit --prod` | ✅ Nenhuma vulnerabilidade conhecida |

## Decisões tomadas

- **Conversão no `@olly/shared-types`, com o catálogo de tipos injetado:** a mesma função serve à API (baixar e importar) e ao editor (copiar e colar), sem criar dependência de `@olly/nodes`.
- **Importador do N8N:**
  - gera um arquivo do Olly Flow e segue pelo mesmo caminho de validação, credenciais, pendências e marcadores;
  - fica em `apps/api/src/workflow-io/n8n/`, não num pacote novo (só a API o usa).
- **`mcpClientTool` → `tool.mcp`:** no N8N ele é uma ferramenta do Agent. A ADR-0001 citava `ai.mcpClient`; registrei uma nota na ADR.
- **Baixar exige `workflow:update`:** atende "Editor e Admin" sem permissão nova nem mudança no seed de papéis.
- **Exportação do canvas por `POST`:** mantém a auditoria e os nomes das credenciais no servidor.
- **Motor:** decide se um nó é sub-nó pelas portas efetivas, para que um marcador ligado como ferramenta fique fora do agendamento.
- **Nenhuma migration:** a auditoria usa as ações novas `workflow.export` e `workflow.import`.

## Desvios da spec/plano

Registrados no histórico da [spec](spec.md) e do [plano](plan.md):
- **Workflow de erro inexistente:** é retirado na importação, porque o salvamento o recusa. As demais referências são mantidas.
- **Colar:** usa o evento `paste` do navegador, e não mais o atalho. O comportamento interno anterior foi mantido, e o E2E da spec 002 passou.
- **Dados fixados ao colar nós:** não são aplicados.
- **Limite de corpo das rotas:** o dobro de `OLLY_IMPORT_MAX_BYTES` + 64 KiB. Acima disso, o Fastify responde 413 com a mensagem padrão.
- **Spec 012:** atualizada antes da implementação (importador movido para esta spec).
- **Pedido do PO após a primeira entrega (07/10/2026):** importar o JSON de um workflow existente passou a sobrepô-lo, em vez de criar outro. Atualizei antes do código a spec (HU-2 cenário 2, FR-010, FR-028 novo), o plano (§3.2) e as tarefas (T033, T055). Os testes de integração foram escritos antes da implementação e falharam como esperado. Dois testes antigos ganharam nome nos arquivos, para não sobreporem um ao outro, e a auditoria esperada ganhou `overwritten`.

## Dependências adicionadas

Nenhuma.

## Pendências, bloqueios e riscos

- **SC-004:** falta medir com um modelo de IA aprovado (ADR-0008), com os 10 pedidos de referência (pré-requisito humano).
- **Workflows reais da POC:** exportá-los em `fixtures/n8n/` (pré-requisito humano). O teste importa automaticamente o que estiver lá e atualiza o relatório consolidado.
- **Risco aceito pelo PO (FR-009):** os dados fixados vão sempre no arquivo baixado e podem conter dados pessoais. Mitigação: só Editor e Admin baixam, com auditoria.
- **Conversores do N8N:** cobrem os tipos da ADR-0001 nas versões atuais. Outras versões viram marcadores com o JSON original, que podem ganhar conversores conforme os workflows da POC aparecerem.

## Como demonstrar

1. `pnpm app:up` e entre em <http://localhost:5173> como editor.
2. **Baixar:** em Workflows, clique no ícone "Baixar" de um workflow. No editor, altere algo sem salvar e clique em **Baixar**: o arquivo traz a alteração.
3. **Importar do Olly Flow:** (importar o JSON baixado de volta no mesmo projeto sobrepõe o workflow: a prévia avisa, e o botão vira "Importar e sobrepor")
   - em **Importar**, mantenha o formato "Olly Flow" e cole o JSON baixado (ou um exemplo da [documentação](../../docs/nos/workflow-json.md#12-exemplos-completos));
   - clique em **Pré-visualizar** e depois em **Importar**: o editor abre o rascunho.
4. **Importar do N8N:** em **Importar**, escolha o formato "N8N" e o arquivo `fixtures/n8n/exemplo-set-if/workflow.json`. Veja o relatório de migração e importe.
5. **Nó marcador:** importe um JSON com um tipo inventado (`"type": "outra.planilha"`). O nó aparece tracejado, "Não suportado", e **Publicar** é recusado.
6. **Copiar e colar:** selecione nós e pressione Ctrl+C, cole num editor de texto (é o JSON do arquivo) e depois Ctrl+V em outro workflow.
7. **Com um modelo de IA:** envie `docs/nos/workflow-json.md` como contexto, peça um workflow e importe o JSON gerado.

## Próximos passos sugeridos

- Exportar para o formato do N8N (ida de volta), se houver necessidade de convivência longa.
- Baixar uma versão específica do histórico; exportar e importar vários workflows de uma vez.
- Conversores para mais nós e versões do N8N, guiados pelos workflows reais da POC.
- Gerar workflows por IA dentro da plataforma, a partir da documentação do formato.
