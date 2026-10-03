# Plano técnico — Spec 013: Hardening, documentação e go-live

**Spec:** [spec.md](spec.md) · **Tarefas:** [tasks.md](tasks.md)

## Resumo da abordagem

- **Achados do pentest:** tratados em ordem de severidade, no fluxo teste → correção → registro.
- **Revisão final de segurança:** automatizada no CI.
- **Documentação:** consolidada em quatro trilhas (usuário, operação, desenvolvimento, treinamento).
- **Migração:** ferramenta de comparação em modo sombra (*shadow*).
- **Go-live:** artefatos para a decisão e a execução humanas.

## Verificação da constituição

| Artigo | Como este plano atende |
|---|---|
| IV.4 | Todo achado começa com um teste de reprodução |
| VI.4 | Aceite de risco reservado a humanos |
| V | Nenhuma funcionalidade nova |

## Design

### §1 Achados do pentest
- **Entrada:** `docs/seguranca/pentest/*`.
- **Para cada achado:**
  1. teste em `security/regressions/<id>.test.ts` que falha;
  2. correção;
  3. teste verde.
- **Saída:** `docs/seguranca/pentest/plano-de-acao.md`, com as colunas ID, severidade, status (`corrigido` | `mitigado` | `pendente de aprovação` | `backlog`), teste e referência da mudança.

### §2 Revisão final de segurança
- **Ferramentas:**
  - `pnpm audit` e `pip-audit` (runner Python);
  - Trivy nas imagens (`infra/docker/*`);
  - gitleaks no repositório.

  Todas rodam no CI, e os resultados ficam no relatório.
- **Cabeçalhos:** `@fastify/helmet` na API e cabeçalhos do nginx no `web`. O CSP restringe `connect-src` à API, ao IdP e ao WebSocket. Teste automatizado dos cabeçalhos.
- **`values-prod.yaml`:** teste que valida `NODE_ENV=production`, Swagger desligado, ausência do realm de dev e ausência de *password grant*.

### §3 Documentação
- **`docs/usuario/`:**
  - primeiros passos;
  - referência de nós, consolidando `docs/nos/*` em um índice;
  - expressões;
  - agentes e MCP;
  - vindo do N8N (paralelismo, While, Merge, `$vars`, permissões);
  - FAQ e solução de problemas.
- **`docs/operacao/`:**
  - runbook com um procedimento por alerta da spec 012;
  - backup e restore: PostgreSQL (PITR, se disponível), MinIO/S3, configuração do Vault, com script `infra/backup/` e registro do teste de restore em homologação;
  - rollback com critérios objetivos (ex.: taxa de erro acima de X% por 15 min, falha de webhook crítico);
  - guia do administrador.
- **`docs/desenvolvimento/`:** como criar um nó (contrato, `paramsSchema`, `x-display-options`, credenciais, *paired items*, testes, documentação) e guia de contribuição (SDD, DoD). Modelo completo em `examples/node-template/`, com testes rodando no CI.
- **`docs/treinamento/`:** roteiros para editores (2 h), executores (30 min) e administradores (1 h 30), com exercícios e workflows de exemplo para importar.

### §4 Comparação com o N8N (`pnpm migration:shadow`)
- **Fonte das execuções:** API do N8N (`N8N_BASE_URL`, `N8N_API_KEY`) ou diretório de exports.
- **Para cada workflow migrado:** busca as N últimas execuções com sucesso, extrai a entrada do gatilho, executa no Olly Flow em modo `shadow` e compara as saídas por nome de nó. A comparação normaliza a ordem quando é semanticamente irrelevante e ignora campos voláteis configuráveis, como timestamps.
- **Modo `shadow`:** nós com efeitos colaterais (`postgres.write`, `http.request` com método diferente de GET, `ai.mcpClient`/`tool.mcp` destrutivos, `http.respondToWebhook`) retornam a saída gravada do N8N para aquele nó (se houver) ou um resultado simulado, sem executar o efeito.
- **Saída:** `docs/migracao/comparacao.md`, com a equivalência por workflow e as divergências explicadas.

### §5 Artefatos de go-live (`docs/go-live/`)
- **`checklist.md`:**
  - infraestrutura;
  - segredos;
  - IdP;
  - backups ativos;
  - alertas roteados;
  - migrations;
  - smoke;
  - workflows publicados;
  - webhooks de origem apontados para o Olly Flow;
  - fluxos migrados desativados no N8N.
- **`values-prod.yaml`** de referência, sem segredos.
- **`pnpm smoke:prod`:** health, login técnico, leitura de metadados e um workflow *canary* somente leitura. Nenhuma escrita.
- **`hypercare.md`:** período, monitoramento reforçado, canal de suporte e critérios de saída.
- **`desligamento-n8n.md`:** ordem de desativação, convivência, backup final e critérios para desligar.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `N8N_BASE_URL`, `N8N_API_KEY` | — | Fonte das execuções para a comparação |

## Decisões técnicas

| Decisão | Alternativas consideradas | Motivo |
|---|---|---|
| Comparação em modo shadow | Execução real em paralelo | Evita efeitos colaterais duplicados |

## Estratégia de testes

| Requisito | Tipo | Caso |
|---|---|---|
| FR-001–FR-003 | Regressão de segurança | `security/regressions/*` (SC-001) |
| FR-004 | CI | Jobs de auditoria e scan (SC-002) |
| FR-005 | Integração | `security-headers.int.test.ts` |
| FR-006 | Unidade | `values-prod.test.ts` |
| FR-008 | Manual registrado | Restore em homologação (SC-003) |
| FR-009 | CI | Testes de `examples/node-template` |
| FR-011 | Integração | `shadow.int.test.ts` + execução real (SC-004) |
| FR-012 | Execução | `pnpm smoke:prod` em homologação (SC-007) |

## Riscos

| Risco | Mitigação |
|---|---|
| Pentest com muitos achados | Priorizar críticos e altos; médios para decisão humana |
| Divergências na comparação | Explicar cada uma; decisão do PO antes do desligamento do N8N |
