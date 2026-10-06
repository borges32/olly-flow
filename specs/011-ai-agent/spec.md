# Spec 011 — AI Agent

| Campo | Valor |
|---|---|
| **Status** | Implementada (com pendências: SC-002 manual e ADR-0008) |
| **Fase** | 3 — IA e governança |
| **Depende de** | 010 |
| **Requisitos de produto** | PR-16, PR-14 (MCP como tool) |
| **ADRs relacionadas** | 0008 |

## Contexto e problema

O objetivo central do projeto é ter agentes de IA que raciocinam e usam as ferramentas da plataforma (MCP, HTTP, Postgres, sub-workflows) dentro de workflows governados. Agentes recebem conteúdo não confiável (*prompt injection*), por isso os controles são obrigatórios:
- limite de passos;
- tools explicitamente permitidas;
- aprovação humana para ações destrutivas;
- registro de cada passo;
- controle de custo.

## Histórias de usuário

### HU-1 — Agente com ferramentas (P1)

Como **editor**, quero montar um agente conectando um modelo de linguagem, memória e ferramentas, para responder a pedidos usando os dados e sistemas da instituição.

**Cenários de aceite:**
1. **Dado** um agente com as tools de consulta Postgres e MCP `consulta_cliente`, **quando** recebe uma pergunta via webhook, **então** usa as tools e responde, com cada passo visível no log.
2. **Dado** um agente que entra em laço de chamadas, **quando** atinge o limite de passos, **então** falha com erro explícito.

### HU-2 — Aprovação humana de ações destrutivas (P1)

Como **responsável pelo processo**, quero aprovar ou rejeitar ações destrutivas antes que o agente as execute.

**Cenários de aceite:**
1. **Dado** um agente que chama `apagar_registro`, **quando** a chamada ocorre, **então** a execução pausa até a decisão. Ao aprovar, a ação ocorre e o agente continua; ao rejeitar, o agente recebe a rejeição e continua.
2. **Dado** uma execução pausada, **quando** o worker reinicia, **então** a pausa é mantida.

### HU-3 — Memória de conversa (P2)

Como **usuário final de um fluxo conversacional**, quero que o agente lembre o contexto da sessão.

### HU-4 — Controle de custo (P2)

Como **gestor**, quero ver o consumo de tokens e o custo por execução, workflow e projeto, e limitar o consumo mensal.

### HU-5 — Resposta estruturada (P2)

Como **editor**, quero exigir que a resposta final siga um schema JSON.

### Casos de borda

- Modelo fora da lista permitida: recusado.
- Resultado de tool enorme: truncado e marcado como não confiável.
- Aprovação não respondida no prazo: rejeitada automaticamente.

## Requisitos funcionais

- **FR-001**: O canvas DEVE suportar sub-nós conectados à base do Agent (modelo, memória, ferramentas). O Agent exige exatamente 1 modelo, no máximo 1 memória e 0 ou mais ferramentas. Sub-nós NÃO DEVEM se conectar ao fluxo principal.
- **FR-002**: O nó `ai.chatModel` DEVE usar credenciais por provedor aprovado (ADR-0008) e parâmetros de modelo (temperatura e top p opcionais — enviados ao provedor só quando preenchidos, pois nem todo modelo os aceita —, máximo de tokens, timeout, tentativas). Modelos fora da lista permitida (instalação e projeto) DEVEM ser recusados. A lista da instalação DEVE ser um cadastro na administração da plataforma, com efeito imediato (sem reiniciar a aplicação).
- **FR-003**: O nó `ai.agent` DEVE executar por item um agente com chamada de ferramentas, com prompt vindo da entrada ou definido, mensagem de sistema, limite de iterações e retorno opcional dos passos intermediários.
- **FR-004**: O Agent DEVE poder validar a resposta final contra um JSON Schema, pedindo correção ao modelo até 2 vezes.
- **FR-005**: A saída DEVE conter a resposta, os passos (opcional) e o uso de tokens.
- **FR-006**: Cada passo do agente DEVE ser registrado (mascarado) e transmitido em tempo real.
- **FR-007**: DEVEM existir as ferramentas:
  - MCP (somente tools permitidas);
  - HTTP Request com parâmetros definidos pelo modelo via `$fromAI()`;
  - consulta Postgres com SQL **fixo** e parâmetros `$fromAI()`;
  - sub-workflow;
  - código JS.

  Toda ferramenta tem nome válido e único e descrição obrigatória.
- **FR-008**: O modelo NÃO DEVE poder escrever SQL.
- **FR-009**: DEVEM existir memórias de conversa persistente (por chave de sessão, com janela de N mensagens e retenção) e temporária (somente na execução).
- **FR-010**: QUANDO o agente chamar uma ferramenta destrutiva, a execução DEVE pausar e criar um pedido de aprovação com a ferramenta, os argumentos (mascarados para exibição) e o motivo. A pausa DEVE sobreviver a reinícios.
- **FR-011**: Usuários com permissão de executar no projeto DEVEM poder aprovar ou rejeitar. A rejeição DEVE ser devolvida ao agente como resultado da ferramenta. Pedidos sem resposta no prazo DEVEM ser rejeitados automaticamente. Tudo DEVE ser auditado.
- **FR-012**: Resultados de ferramentas DEVEM ser truncados e delimitados como conteúdo não confiável no prompt.
- **FR-013**: DEVE existir uma opção que exige aprovação para ferramentas destrutivas após o agente ler conteúdo externo, mesmo sem marcação.
- **FR-014**: O sistema DEVE registrar tokens e custo estimado (preços configuráveis pelo administrador) por execução, e exibir os totais por workflow e por projeto.
- **FR-015**: O sistema DEVE permitir um limite mensal de tokens por projeto. Ao atingir o limite, novas chamadas falham com erro claro.
- **FR-016**: Os testes DEVEM usar um modelo simulado determinístico, com respostas e chamadas de ferramenta roteirizadas.

## Requisitos não funcionais

- **NFR-001**: Limite padrão de 10 iterações (teto configurável).
- **NFR-002**: Prazo padrão de aprovação de 24 h.

## Entidades-chave

- **Passo do agente**, **Memória de sessão**, **Pedido de aprovação**, **Uso de LLM**, **Tabela de preços**.

## Critérios de sucesso

- **SC-001**: Webhook → Agent (modelo simulado) usa as tools Postgres e MCP e responde; os passos aparecem no log.
- **SC-002**: O mesmo cenário funciona com o provedor real de homologação (se disponível; registro manual).
- **SC-003**: Pausa, aprovação e rejeição de `apagar_registro` funcionam.
- **SC-004**: A pausa sobrevive ao reinício do worker.
- **SC-005**: O limite de iterações gera erro explícito.
- **SC-006**: Modelo fora da lista é recusado.
- **SC-007**: Resposta estruturada corrigida ou falha após 2 tentativas.
- **SC-008**: Memória mantém o contexto entre execuções da mesma sessão.
- **SC-009**: Tokens e custo registrados; o limite mensal bloqueia.

## Fora do escopo

RAG/vector store, chat trigger, *fine-tuning* e avaliação automática de respostas.

## Pré-requisitos humanos

- ADR-0008 decidida, com provedores, modelos e chaves de homologação. Se não estiver, usar um provedor compatível com a API OpenAI + modelo simulado e registrar a pendência.
- Tabela de preços dos modelos aprovados.

## Pontos em aberto

- ~~[PRECISA ESCLARECIMENTO: limite mensal padrão de tokens por projeto?]~~ Resolvido (06/10/2026): sem limite padrão; o limite é definido por projeto pela administração.
- ~~[PRECISA ESCLARECIMENTO: quem pode aprovar ações destrutivas — qualquer executor do projeto ou um papel específico?]~~ Resolvido (06/10/2026): quem tem `workflow:execute` no projeto.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 03/10/2026 | Criação a partir do prompt da Sprint 10 | Migração para SDD |
| 06/10/2026 | Pontos em aberto resolvidos (sem limite mensal padrão; aprovação por `workflow:execute`); tabela de preços semeada com os preços públicos dos modelos, editável | Decisão humana |
| 06/10/2026 | FR-002: a lista de modelos da instalação deixa de ser a variável `OLLY_ALLOWED_MODELS` e passa a ser um cadastro em Administração › IA, com efeito imediato | Decisão humana: incluir ou remover um modelo não pode exigir reciclar os pods |
| 06/10/2026 | FR-002: `top p` acrescentado; temperatura e top p passam a ser opcionais (sem valor padrão: vazio = o padrão do modelo) | Teste do usuário com `gpt-5-mini`: o modelo recusa temperatura diferente de 1, e modelos recentes da Anthropic recusam top p |
| 06/10/2026 | Dependência explícita da spec 008: estado/retomada (`waiting`), `flow.wait` e sub-workflow (T001, T040, T041 da 008) são implementados antes desta spec | Decisão humana: a 008 foi adiada, mas a aprovação humana e o `tool.workflow` dependem dessas partes |
