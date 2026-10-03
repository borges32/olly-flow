# Registro de Decisões de Arquitetura (ADR) — Olly Flow

> Cada decisão segue o formato: **Contexto → Decisão → Consequências**.
> Status possíveis: `Proposta` · `Aceita` · `Substituída` · `Rejeitada`.
>
> Documento base: [analise_implementacao.md](analise_implementacao.md)

| ADR | Título | Status | Data |
|---|---|---|---|
| [001](#adr-001--abordagem-híbrida-plataforma-própria-compatível-com-o-n8n) | Abordagem híbrida: plataforma própria compatível com o N8N | **Aceita** | 02/10/2026 |
| [002](#adr-002--backend-em-nodejs--typescript-com-nestjs) | Backend em Node.js + TypeScript com NestJS | Proposta | 02/10/2026 |
| [003](#adr-003--sandbox-javascript-com-isolated-vm-em-task-runner-separado) | Sandbox JavaScript com isolated-vm em task runner separado | Proposta | 02/10/2026 |
| [004](#adr-004--runner-python-em-container-isolado) | Runner Python em container isolado | Proposta | 02/10/2026 |
| [005](#adr-005--autenticação-via-oidc-federado-ao-diretório-institucional) | Autenticação via OIDC federado ao diretório institucional | Proposta | 02/10/2026 |
| [006](#adr-006--infraestrutura-de-execução) | Infraestrutura de execução | Proposta | 02/10/2026 |
| [007](#adr-007--gestão-de-segredos) | Gestão de segredos | Proposta | 02/10/2026 |
| [008](#adr-008--provedor-de-llm-e-camada-de-ia) | Provedor de LLM e camada de IA | Proposta | 02/10/2026 |

---

## ADR-001 — Abordagem híbrida: plataforma própria compatível com o N8N

**Status:** Aceita · **Data:** 02/10/2026

### Contexto

A POC com N8N validou o paradigma visual e o modelo de dados entre nós. Porém, requisitos institucionais (RBAC granular, SSO/AD, auditoria, LGPD, controle da execução de código, nós de IA/MCP como primeira classe) exigem recursos do plano Enterprise do N8N ou customizações que a licença (*Sustainable Use License*) e a arquitetura do produto não favorecem. Construir do zero, sem referência, aumentaria a curva de aprendizado dos usuários e o risco de semântica mal definida no motor.

### Decisão

Construir uma **plataforma própria (Olly Flow)**, mantendo **compatibilidade conceitual com o N8N** nos pontos que afetam o usuário e a migração, e **divergindo** onde os requisitos institucionais pedem.

#### 1. O que será compatível com o N8N

| Aspecto | Compatibilidade |
|---|---|
| **Modelo de itens** | Idêntico: cada nó recebe/retorna `[{ json: {...}, binary?: {...} }]` |
| **Sintaxe de expressões** | `{{ ... }}` com as mesmas variáveis: `$json`, `$binary`, `$input.all()`, `$input.first()`, `$input.item`, `$('Nome do Nó').item.json`, `$('Nome do Nó').all()`, `$vars`, `$env`, `$execution.id`, `$workflow.name`, `$now`, `$today` (Luxon) |
| **Sintaxe legada** | `$node["Nome do Nó"].json` aceita para facilitar a migração |
| **Nó de código JS** | Mesma API (`$input.all()`, retorno `[{ json }]`), modos "uma vez para todos os itens" e "uma vez por item" |
| **Nó de código Python** | Mesma API do N8N (`_input.all()`, `_json`, retorno `[{"json": ...}]`), validada contra a versão do N8N usada na POC |
| **Nomes e parâmetros dos nós** | Equivalentes sempre que possível (Webhook, If, HTTP Request, Postgres, Merge, Set, Respond to Webhook, Code) |
| **UX do editor** | Canvas, painel de parâmetros com entrada/saída lado a lado, *pin data*, arrastar campos para gerar expressões |
| **Importação** | **Importador de JSON do N8N** para os nós suportados (ver item 3) |

#### 2. Onde o Olly Flow diverge intencionalmente

| Aspecto | N8N | Olly Flow |
|---|---|---|
| RBAC | Básico no Community, granular no Enterprise | Granular nativo (Admin, Editor, Executor, Visualizador) por projeto, com grupos do AD |
| Loop | Sem nó While; loops via arestas de retorno / Loop Over Items | Nó **While** estruturado (portas `loop`/`done`/`continue`) + `maxIterations` |
| Paralelismo | Execução de ramos em ordem (v1) | Ramos independentes executam **em paralelo** com limite de concorrência |
| Merge | Até 2 entradas por padrão | **N entradas**, com modos append, por posição, join por campo, escolher ramo e barreira |
| Logs | Execuções salvas no banco; streaming no Enterprise | Log por nó em todas as execuções, mascaramento LGPD, retenção, OpenTelemetry |
| Auditoria | Enterprise | Nativa, append-only |
| MCP / Agents | Nós LangChain do N8N | Cliente MCP com catálogo aprovado + AI Agent (LangChain.js) |
| Formato interno | `connections` indexado pelo **nome** do nó | `edges` indexado pelo **id** do nó (renomear não quebra referências) |

#### 3. Importador N8N → Olly Flow

- Converte `nodes[]` e `connections` do JSON exportado pelo N8N para o formato interno (`nodes` + `edges` por id).
- Mapeamento inicial de tipos:

| Tipo N8N | Nó Olly Flow |
|---|---|
| `n8n-nodes-base.manualTrigger` | `trigger.manual` |
| `n8n-nodes-base.webhook` | `trigger.webhook` |
| `n8n-nodes-base.scheduleTrigger` | `trigger.schedule` |
| `n8n-nodes-base.if` | `logic.if` |
| `n8n-nodes-base.switch` | `logic.switch` |
| `n8n-nodes-base.merge` | `logic.merge` |
| `n8n-nodes-base.splitInBatches` | `logic.loopOverItems` |
| `n8n-nodes-base.set` | `data.set` |
| `n8n-nodes-base.httpRequest` | `http.request` |
| `n8n-nodes-base.postgres` (executeQuery) | `postgres.query` |
| `n8n-nodes-base.postgres` (insert/update/upsert) | `postgres.write` |
| `n8n-nodes-base.code` | `code.javascript` / `code.python` (conforme `language`) |
| `n8n-nodes-base.respondToWebhook` | `http.respondToWebhook` |
| `@n8n/n8n-nodes-langchain.agent` | `ai.agent` |
| `@n8n/n8n-nodes-langchain.mcpClientTool` | `ai.mcpClient` |

- **Credenciais não são importadas**: o importador lista as credenciais referenciadas para que sejam recadastradas no cofre do Olly Flow.
- Nós não suportados são importados como **nó placeholder** (desabilitado, destacado no canvas) com o JSON original preservado, para não perder informação.
- O importador gera um **relatório de migração** (nós convertidos, pendentes, expressões que precisam de revisão).

#### 4. Convivência com o N8N durante a transição

- O N8N da POC **continua operando** os fluxos atuais até a migração.
- **Nenhum fluxo novo crítico** deve ser criado no N8N a partir desta decisão.
- Desligamento do N8N após o go-live do Olly Flow e a migração validada dos fluxos existentes.

### Consequências

**Positivas**
- Curva de aprendizado baixa para quem participou da POC; documentação e exemplos do N8N continuam úteis como referência.
- Migração dos fluxos da POC parcialmente automatizada.
- Semântica do motor ancorada em um produto já testado, reduzindo decisões em aberto.
- Liberdade para atender RBAC, auditoria, LGPD e IA sem depender de licença comercial.

**Negativas / custos**
- O motor de expressões precisa reproduzir o comportamento do N8N (inclusive casos de borda) — exige uma **suíte de testes de compatibilidade**.
- Divergências (While, paralelismo, Merge N-entradas) precisam ser bem documentadas para não confundir usuários vindos do N8N.
- O importador é um componente extra a manter, e acompanha apenas os nós suportados.
- Compatibilidade é **conceitual**, não binária: o Olly Flow não executa nós da comunidade N8N nem lê o banco do N8N.

**Ponto de revisão:** fim da fase 1 (MVP), junto com o go/no-go de TCO versus N8N Enterprise.

---

## ADR-002 — Backend em Node.js + TypeScript com NestJS

**Status:** Proposta

- **Contexto:** o motor de expressões e o nó de código JS precisam ser compatíveis com o N8N (ADR-001), que é Node/TS; o frontend é React/TS.
- **Decisão proposta:** API, motor e workers em **Node.js 22 LTS + TypeScript**, usando **NestJS** (módulos, injeção de dependência e *guards* que facilitam o RBAC). Monorepo com **pnpm workspaces + Turborepo**. Tipos compartilhados entre front e back.
- **Alternativa considerada:** Fastify puro (mais leve, porém exige montar a estrutura de módulos/guards manualmente).

## ADR-003 — Sandbox JavaScript com isolated-vm em task runner separado

**Status:** Proposta

- **Decisão proposta:** código JS de usuário e avaliação de expressões rodam em **isolated-vm** dentro de um **processo task runner** separado do worker, com limites de memória (128 MB) e tempo (30 s para código, 100 ms para expressões).
- **Motivo:** isolamento real de V8; o `vm2` foi descontinuado por vulnerabilidades de escape. Processo separado limita o impacto de uma eventual falha.

## ADR-004 — Runner Python em container isolado

**Status:** Proposta

- **Decisão proposta:** serviço **python-runner** (FastAPI) em container dedicado; cada execução em subprocesso sob **nsjail**, sem rede, FS somente leitura, usuário sem privilégios. Se o cluster suportar, usar **gVisor (runsc)** como camada adicional.
- **Bibliotecas:** imagem versionada com allowlist (pandas, numpy, python-dateutil...), mantida pelo time da plataforma.
- **Alternativa considerada:** Pyodide no worker (mais simples, porém com restrições de bibliotecas e desempenho).

## ADR-005 — Autenticação via OIDC federado ao diretório institucional

**Status:** Proposta — **depende de informação da instituição**

- **Decisão proposta:** a aplicação fala apenas **OIDC**. Se a instituição já tiver um IdP (Entra ID/Azure AD, ADFS, Keycloak), integrar direto; caso contrário, subir **Keycloak** federado ao AD/LDAP.
- **Pendência:** confirmar qual IdP/diretório a instituição usa.

## ADR-006 — Infraestrutura de execução

**Status:** Proposta — **depende de informação da instituição**

- **Decisão proposta:** **Docker Compose** para desenvolvimento e homologação; **Kubernetes (Helm)** em produção, permitindo escalar workers independentemente da API.
- **Pendência:** confirmar se a instituição já opera Kubernetes (on-premises ou nuvem) e se há restrição de nuvem pública.

## ADR-007 — Gestão de segredos

**Status:** Proposta — **depende de informação da instituição**

- **Decisão proposta:** credenciais dos workflows criptografadas com **AES-256-GCM** (envelope encryption), com a chave mestra em **HashiCorp Vault** ou no KMS da nuvem já usada pela instituição. Rotação de chave suportada via `key_version`.
- **Pendência:** confirmar se já existe Vault/KMS corporativo.

## ADR-008 — Provedor de LLM e camada de IA

**Status:** Proposta — **depende de informação da instituição**

- **Decisão proposta:** nós de IA construídos sobre **LangChain.js / LangGraph.js**, com provedor de LLM **configurável por credencial** (não acoplar a um único fornecedor). MCP via SDK oficial `@modelcontextprotocol/sdk`.
- **Pendência:** confirmar quais provedores/modelos estão aprovados pela instituição (contratos, LGPD, residência de dados) e se há necessidade de modelos on-premises.
