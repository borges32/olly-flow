# Visão de Produto — Olly Flow

> Documento de produto: **o quê** e **para quem**. Detalhes técnicos ficam em [`docs/arquitetura/`](../arquitetura/) e nos `plan.md` das specs. Estudo de origem: [análise de implementação](../estudos/analise_implementacao.md).

## 1. Problema

A instituição validou, em uma POC com N8N, que automações visuais combinando IA (LLMs e agentes), APIs e bancos de dados geram valor. Para levar isso à produção, a instituição precisa de requisitos que o N8N só oferece no plano Enterprise ou não oferece:
- controle de acesso granular;
- login institucional (AD);
- auditoria e conformidade com a LGPD;
- controle sobre a execução de código;
- IA e MCP como recursos centrais.

## 2. Visão

> Uma plataforma interna em que equipes montam, testam e operam workflows com IA de forma visual, com a familiaridade do N8N e a governança que a instituição exige.

Decisão de abordagem: [ADR-0001 — plataforma própria compatível com o N8N](../adr/0001-abordagem-hibrida.md).

## 3. Usuários e papéis

| Papel | Quem é | O que faz |
|---|---|---|
| **Administrador** | Time da plataforma | Gerencia usuários, projetos, papéis, catálogo MCP, modelos de IA, políticas e auditoria |
| **Editor** | Desenvolvedores e analistas técnicos | Cria, edita, testa e publica workflows; gerencia credenciais do projeto |
| **Executor** | Operadores e analistas de negócio | Executa workflows publicados e acompanha execuções |
| **Visualizador** | Gestores, auditores, interessados | Consulta workflows e o histórico de execuções (sem dados sensíveis) |
| **Sistema externo** | Aplicações da instituição | Aciona workflows via webhook e recebe respostas |

## 4. Requisitos de produto

Os itens PR-01 a PR-14 são os requisitos originais solicitados. Os itens PR-15 a PR-20 decorrem da análise e da ADR-0001.

| ID | Requisito | Prioridade |
|---|---|---|
| PR-01 | Nó **While** (laço com condição) | Obrigatório |
| PR-02 | Nó **If** (desvio condicional) | Obrigatório |
| PR-03 | Nó **HTTP Request** | Obrigatório |
| PR-04 | Nó de **query PostgreSQL** | Obrigatório |
| PR-05 | Nó de **inclusão/alteração de registros no PostgreSQL** | Obrigatório |
| PR-06 | **Webhook de entrada** | Obrigatório |
| PR-07 | **Log de todas as execuções** de workflow | Obrigatório |
| PR-08 | **RBAC** com papéis para criar, visualizar e executar workflows | Obrigatório |
| PR-09 | Nó de **código JavaScript** | Obrigatório |
| PR-10 | Nó de **código Python** | Obrigatório |
| PR-11 | **Transferência de valores/variáveis entre nós** | Obrigatório |
| PR-12 | **Processamento paralelo** de nós | Obrigatório |
| PR-13 | Nó de **Merge** de dados | Obrigatório |
| PR-14 | Nó **cliente MCP** | Obrigatório |
| PR-15 | **Editor visual** de workflows (canvas) com teste interativo | Obrigatório |
| PR-16 | **AI Agent** usando tools da plataforma (MCP, HTTP, Postgres, sub-workflows) | Obrigatório |
| PR-17 | **Compatibilidade e migração** a partir do N8N | Obrigatório |
| PR-18 | **Gestão segura de credenciais** | Obrigatório |
| PR-19 | **Auditoria, versionamento e LGPD** | Obrigatório |
| PR-20 | **Operação**: escalabilidade, observabilidade, implantação | Obrigatório |

## 5. Requisitos não funcionais globais

| ID | Requisito |
|---|---|
| NFR-G01 | Código de usuário (JS/Python) e expressões executam isolados, sem acesso ao host, com limites de recursos |
| NFR-G02 | Credenciais criptografadas em repouso; nunca expostas na UI, API, logs ou dados de execução |
| NFR-G03 | Login por usuário local (e-mail e senha) como padrão; login pelo provedor de identidade institucional (OIDC) opcional, ativável e desativado por padrão. O primeiro usuário de uma instalação nova é local e administrador global (spec 014; decisão do PO em 06/10/2026, que substitui "login exclusivamente via OIDC") |
| NFR-G04 | Toda ação administrativa e de edição é auditável |
| NFR-G05 | Dados pessoais mascarados em logs e históricos (LGPD), com retenção configurável |
| NFR-G06 | Workers escaláveis horizontalmente; falha de um worker não deixa execuções em estado indefinido |
| NFR-G07 | Interface em português do Brasil |
| NFR-G08 | Metas de carga e disponibilidade a definir pelo PO antes da spec 012. **[PRECISA ESCLARECIMENTO: metas de throughput, latência e disponibilidade]** |

## 6. Matriz de rastreabilidade (requisito de produto → specs)

| PR | 001 | 002 | 003 | 004 | 005 | 006 | 007 | 008 | 009 | 010 | 011 | 012 | 013 | 014 | 015 | 016 | 017 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PR-01 While | | | | | | | ● | | | | | | | | | | |
| PR-02 If | | | ● | | | | ○ | | | | | | | | | | |
| PR-03 HTTP | | | | ● | | | | ○ | | | | | | | | | |
| PR-04 Query PG | | | | ● | | | | | | | | | | | | | |
| PR-05 Escrita PG | | | | ● | | | | | | | | | | | | | |
| PR-06 Webhook | | | | | ● | | | | | | | | | | | | |
| PR-07 Log | | | ● | | ● | | | | ○ | | | ○ | | | | | |
| PR-08 RBAC | ○ | ● | | | ● | | | | ○ | | | | | ○ | | | |
| PR-09 JS | | | | | ● | | | | | | | | | | | | |
| PR-10 Python | | | | | | | | ● | | | | | | | | | |
| PR-11 Variáveis | | | ● | | | | | | | | | | | | | | |
| PR-12 Paralelo | | | | | | ● | | | | | | | | | | | |
| PR-13 Merge | | | | | | | ● | | | | | | | | | | |
| PR-14 MCP | | | | | | | | | | ● | ○ | | | | | | |
| PR-15 Editor | ○ | ● | ● | | | | | | | | | | | | ○ | | |
| PR-16 Agent | | | | | | | | | | | ● | | | | | ○ | ○ |
| PR-17 N8N | | | ○ | | ○ | | | | | | | | ○ | | ● | ○ | ○ |
| PR-18 Credenciais | | | | ● | | | | | ○ | | | | | | ○ | ○ | |
| PR-19 Auditoria/LGPD | ○ | | | | ● | | | | ● | | | | | | ○ | | |
| PR-20 Operação | ○ | | | | | ● | | | | | | ● | ● | ○ | | | |

● entrega principal · ○ entrega parcial/complementar

## 7. Fora do escopo do produto (nesta versão)

- Execução de nós da comunidade N8N ou leitura do banco do N8N.
- Marketplace público de nós.
- RAG/vector store, chat trigger e ambientes com promoção via Git: candidatos a specs pós go-live (ver [roadmap](../roadmap.md)).
