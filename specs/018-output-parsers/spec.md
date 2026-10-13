# Spec 018 — Output Parsers como no N8N

| Campo | Valor |
|---|---|
| **Status** | Implementada com pendências (testes de tempo das specs 002 e 003 no ambiente atual) |
| **Fase** | 4 — Hardening (paridade com o N8N, apoio à migração) |
| **Depende de** | 011, 015, 017 |
| **Requisitos de produto** | PR-16 (parcial), PR-17 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje, o **Agent** (spec 011) e o **Basic LLM Chain** (spec 017) definem a resposta estruturada por um JSON Schema dentro do próprio nó. No N8N é diferente:
- os dois nós têm a opção **"Require Specific Output Format"**, que acrescenta uma entrada **Output Parser**;
- nessa entrada se liga um sub-nó de output parser:
  - **Structured Output Parser:** objeto JSON, definido por um exemplo JSON ou por um JSON Schema;
  - **Auto-fixing Output Parser:** envolve outro parser e usa um modelo de chat para corrigir a resposta inválida;
  - **Item List Output Parser:** lista de itens.

A diferença atrapalha a migração. Quem conhece o N8N procura os parsers e não os encontra, e o formato do Olly Flow não cobre a lista de itens nem a correção por um modelo separado. O PO decidiu, em 09/10/2026, adotar os output parsers **como no N8N**:
- os três sub-nós passam a existir;
- o JSON Schema dentro do nó é **substituído**;
- os workflows existentes são **migrados** automaticamente.

## Histórias de usuário

### HU-1 — Exigir um formato com um Output Parser (Prioridade: P1)

Como **editor**, quero ligar "Exigir formato específico" no Agent ou no Basic LLM Chain e ligar um output parser à entrada que aparece, para receber a resposta no formato que os nós seguintes esperam, como no N8N.

**Teste independente:** num Agent e num Basic LLM Chain com o modelo simulado, ligar a opção, conectar um Structured Output Parser e conferir a entrada nova, a validação e a saída estruturada.

**Cenários de aceite:**
1. **Dado** um Agent ou um Basic LLM Chain, **quando** ligo "Exigir formato específico", **então** aparece a entrada **Output Parser**, que aceita um único parser.
2. **Dado** a opção ligada sem parser conectado, **quando** salvo ou executo, **então** a validação aponta a falta do parser.
3. **Dado** a opção desligada, **quando** há um parser conectado, **então** ele é ignorado e a resposta sai em texto, como hoje.
4. **Dado** um parser conectado, **quando** o nó executa, **então** as instruções de formato do parser vão ao modelo e a resposta interpretada sai no campo `output`.

### HU-2 — Structured Output Parser (Prioridade: P1)

Como **editor**, quero definir o objeto da resposta por um exemplo JSON ou por um JSON Schema, como no N8N.

**Teste independente:** com cada forma de definição, conferir o objeto na saída, a correção da resposta inválida e a falha depois das tentativas.

**Cenários de aceite:**
1. **Dado** o parser com "a partir de um exemplo JSON", **quando** o modelo responde no formato do exemplo, **então** a saída traz o objeto.
2. **Dado** o parser com "JSON Schema", **quando** a resposta não segue o schema, **então**:
   - com a correção automática ligada, o modelo do nó é chamado para corrigir, como hoje (até 2 vezes);
   - com ela desligada, o item falha com os problemas encontrados.
3. **Dado** um exemplo ou schema inválido, **quando** salvo ou executo, **então** o erro cita o parâmetro.

### HU-3 — Auto-fixing Output Parser (Prioridade: P2)

Como **editor**, quero envolver um parser com uma correção feita por um modelo de chat próprio, para corrigir respostas inválidas com outro modelo (por exemplo, mais barato), como no N8N.

**Teste independente:** com um parser interno e um modelo de correção simulados, uma resposta inválida é corrigida pelo modelo do Auto-fixing e a saída é o objeto corrigido.

**Cenários de aceite:**
1. **Dado** um Auto-fixing com um modelo e um parser ligados a ele, **quando** o parser interno recusa a resposta, **então** o modelo do Auto-fixing recebe a resposta e o erro e devolve a versão corrigida, que passa de novo pelo parser interno.
2. **Dado** a correção ainda inválida, **quando** a tentativa acaba, **então** o item falha com o erro do parser interno.
3. **Dado** um prompt de correção personalizado, **quando** a correção acontece, **então** ele é usado no lugar do padrão.
4. **Dado** o Auto-fixing sem modelo ou sem parser interno ligado, **quando** salvo ou executo, **então** a validação aponta o que falta.

### HU-4 — Item List Output Parser (Prioridade: P2)

Como **editor**, quero receber a resposta como uma lista de itens, por exemplo cinco ideias de título, como no N8N.

**Teste independente:** com o modelo simulado, a resposta vira uma lista, respeitando o separador e o número de itens.

**Cenários de aceite:**
1. **Dado** o parser de lista, **quando** o modelo responde com um item por linha, **então** a saída traz a lista em `output`, sem linhas vazias e sem os marcadores de lista ("1.", "-").
2. **Dado** um número de itens definido, **quando** a resposta tem mais itens, **então** a lista é cortada nesse número.
3. **Dado** um separador personalizado, **quando** o modelo responde, **então** a lista é separada por ele.

### HU-5 — Migração dos workflows do Olly Flow (Prioridade: P1)

Como **editor**, quero que os workflows que já usam o JSON Schema dentro do nó continuem funcionando.

**Teste independente:** abrir e executar um workflow salvo com o schema dentro do nó e conferir o parser criado e a mesma saída.

**Cenários de aceite:**
1. **Dado** um workflow salvo com o schema dentro do Agent ou do Basic LLM Chain, **quando** abro, executo ou publico, **então** ele é tratado como um Structured Output Parser ligado ao nó, com o mesmo schema e a correção automática ligada. A saída e as correções continuam iguais.
2. **Dado** um arquivo JSON do Olly Flow no formato antigo, **quando** importo, **então** a mesma migração é aplicada.

### HU-6 — Migração do N8N com os nós alterados (Prioridade: P1)

Como **editor**, quero importar do N8N workflows com o AI Agent, o Basic LLM Chain e os output parsers, para que cheguem com a mesma estrutura do N8N: a opção ligada nos nós, os parsers como sub-nós e as mesmas conexões. Assim não há marcadores nem schemas escondidos dentro dos nós.

**Teste independente:** importar, no formato N8N, workflows com o AI Agent e o Basic LLM Chain ligados a cada um dos três parsers, incluindo um Auto-fixing com o próprio modelo e um parser interno, e conferir tipos, parâmetros, conexões, validação e relatório.

**Cenários de aceite:**
1. **Dado** um AI Agent ou um Basic LLM Chain do N8N com "Require Specific Output Format" e um Structured Output Parser ligado, **quando** importo, **então**:
   - o nó chega com "Exigir formato específico" ligado;
   - o parser chega como sub-nó ligado à entrada Output Parser, com o mesmo exemplo JSON ou JSON Schema e a mesma opção de correção automática;
   - o relatório não traz aviso de output parser.
2. **Dado** um Auto-fixing Output Parser do N8N com um modelo e um parser interno ligados a ele, **quando** importo, **então** os três chegam como sub-nós, com as conexões em cadeia (modelo e parser interno no Auto-fixing; Auto-fixing no nó) e o prompt de correção personalizado, quando houver.
3. **Dado** um Item List Output Parser do N8N, **quando** importo, **então** ele chega com o mesmo separador e número de itens.
4. **Dado** um Structured Output Parser de versão antiga do N8N (com o JSON Schema no campo da v1), **quando** importo, **então** ele chega como "JSON Schema" com o mesmo schema.
5. **Dado** a opção ligada no nó do N8N sem parser conectado, ou um parser sem nó de destino, **quando** importo, **então** o relatório e a validação apontam a pendência, sem perder o restante do workflow.
6. **Dado** um Basic LLM Chain com modelo reserva e parser, **quando** importo, **então** o modelo reserva e o parser chegam cada um à sua entrada.
7. **Dado** um arquivo do Olly Flow exportado antes desta spec, com o schema dentro do nó, **quando** importo no formato "Olly Flow", **então** a migração da HU-5 é aplicada.

### Casos de borda

- **Mais de um parser ligado:** a validação aponta o limite de um parser.
- **Parser ligado a outro tipo de nó:** só o Agent, o Basic LLM Chain e o Auto-fixing têm a entrada de parser.
- **Correções no Basic LLM Chain com modelo reserva:** as correções do Structured usam o modelo que respondeu (spec 017).
- **Passos:** cada chamada de correção (do nó ou do Auto-fixing) aparece nos passos do painel, com o modelo que respondeu.
- **Uso e limite mensal:** as chamadas de correção, inclusive as do modelo do Auto-fixing, contam no uso, no custo e no limite mensal.
- **Lista vazia:** uma resposta sem itens gera uma lista vazia, sem erro.

## Requisitos funcionais

- **FR-001**: O Agent e o Basic LLM Chain DEVEM ter a opção **"Exigir formato específico"**. Quando ligada, ela acrescenta a entrada **Output Parser**, obrigatória e com no máximo um parser. Desligada, a resposta sai em texto (Agent: `output`; Basic LLM Chain: `text`).
- **FR-002**: Com um parser ligado:
  - as **instruções de formato** do parser DEVEM ir ao modelo junto com o pedido;
  - a resposta interpretada DEVE sair no campo **`output`** do item, como no N8N.
- **FR-003**: DEVE existir o sub-nó **Structured Output Parser**:
  - a definição é por um **exemplo JSON** (o schema é inferido do exemplo) ou por um **JSON Schema**;
  - tem uma opção de **correção automática** pelo modelo do nó, com até 2 tentativas.
  - Sem a correção, a resposta inválida faz o item falhar com os problemas encontrados.
- **FR-004**: DEVE existir o sub-nó **Auto-fixing Output Parser**:
  - tem uma entrada de **modelo** e uma de **parser** (obrigatórias);
  - quando o parser interno recusar a resposta, o modelo do Auto-fixing DEVE receber a resposta, o erro e as instruções de formato, e a versão corrigida passa de novo pelo parser interno (uma tentativa, como no N8N);
  - o prompt de correção DEVE ser personalizável.
- **FR-005**: DEVE existir o sub-nó **Item List Output Parser**:
  - transforma a resposta numa lista de textos, com o separador definido (padrão: quebra de linha);
  - ignora itens vazios e marcadores de lista;
  - limita a lista ao número de itens definido (padrão: sem limite).
- **FR-006**: O JSON Schema dentro do Agent e do Basic LLM Chain (`outputParser: jsonSchema` + `schema`) DEVE ser **substituído** pelos parsers. Workflows salvos e arquivos importados no formato antigo DEVEM ser **migrados automaticamente**: a opção ligada, mais um Structured Output Parser ligado ao nó, com o mesmo schema e a correção automática ligada. As versões publicadas continuam executando com o mesmo resultado.
- **FR-007**: As chamadas de correção DEVEM seguir a governança de IA (spec 011): limite mensal, registro de uso e custo, e passos no painel, com o modelo que respondeu.
- **FR-008**: A importação do N8N (spec 015) DEVE refletir as alterações dos nós:
  - **AI Agent e Basic LLM Chain:** o "Require Specific Output Format" (`hasOutputParser`) vira a opção do FR-001. O aviso "output parser não convertido" deixa de existir;
  - **Structured Output Parser (versões 1 a 1.3):** vira o sub-nó do FR-003, com o exemplo JSON ou o JSON Schema (inclusive o campo da v1), e a correção automática como veio;
  - **Auto-fixing Output Parser:** vira o sub-nó do FR-004, com o prompt de correção e as conexões do seu modelo e do seu parser interno;
  - **Item List Output Parser:** vira o sub-nó do FR-005, com o separador e o número de itens.
- **FR-009**: As conexões `ai_outputParser` do N8N DEVEM ser mantidas: do parser para o Agent, para o Basic LLM Chain ou para o Auto-fixing. Elas convivem com as do modelo reserva (spec 017). A absorção do Structured Output Parser como JSON Schema dentro do nó (feita nas specs 011 e 017) DEVE ser removida.
- **FR-010**: O relatório da importação DEVE apontar as pendências dos parsers:
  - opção ligada sem parser;
  - parser sem nó de destino;
  - Auto-fixing sem modelo ou sem parser interno;
  - exemplo JSON inválido.

  A documentação da importação (`docs/importacao-n8n.md`) e o relatório das fixtures DEVEM ser atualizados.
- **FR-011**: A documentação DEVE incluir as páginas dos três parsers em `docs/nos/`, as mudanças no Agent e no Basic LLM Chain, e os tipos na documentação do formato JSON (spec 015, FR-021).

## Requisitos não funcionais

- **NFR-001**: Sem resposta inválida, um parser não deve acrescentar chamadas ao modelo.
- **NFR-002**: Toda a verificação automatizada usa o modelo simulado (spec 011).

## Entidades-chave

- **Output parser:** sub-nó que dá as instruções de formato ao modelo e interpreta a resposta (objeto, lista ou correção).
- **Instruções de formato:** texto que diz ao modelo como responder (por exemplo, o JSON Schema esperado).

## Critérios de sucesso

- **SC-001**: Com o modelo simulado, o Agent e o Basic LLM Chain com um Structured Output Parser (exemplo JSON e JSON Schema) devolvem o objeto em `output`. A resposta inválida é corrigida com a correção automática, ou falha sem ela.
- **SC-002**: O Auto-fixing corrige uma resposta inválida com o seu próprio modelo, com o uso e os passos registrados com esse modelo.
- **SC-003**: O Item List devolve a lista respeitando o separador e o limite.
- **SC-004**: Um workflow salvo com o JSON Schema dentro do nó é migrado e executa com a mesma saída de antes.
- **SC-005**: Workflows do N8N com o AI Agent e o Basic LLM Chain ligados aos três parsers (inclusive um Auto-fixing com modelo e parser interno, e um Basic LLM Chain com reserva e parser) são importados sem nós marcadores e sem erros de validação, com os mesmos parâmetros e conexões do N8N.

## Fora do escopo

- Outros parsers do N8N além dos três (nenhum outro existe na versão de referência).
- Parsers ligados a nós que não sejam o Agent, o Basic LLM Chain e o Auto-fixing.

## Pré-requisitos humanos

- Workflows da POC que usam output parsers em `fixtures/n8n/`, quando houver.

## Pontos em aberto

- Nenhum. (Respondidos pelo PO em 09/10/2026; ver o histórico.)

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 09/10/2026 | Criação, com as decisões do PO: (1) output parsers como no N8N — Structured, Auto-fixing e Item List — como sub-nós ligados ao Agent e ao Basic LLM Chain; (2) o JSON Schema dentro do nó é substituído, com migração automática dos workflows existentes | Mudança de escopo pedida pelo PO (substitui a decisão "formato por JSON Schema no nó" das specs 011 e 017) |
| 09/10/2026 | Migração do N8N detalhada para as alterações dos nós (pedido do PO): HU-6, FR-008 a FR-010 e SC-005 ampliado; a migração dos workflows do Olly Flow ficou na HU-5; a documentação passou a ser o FR-011 | Pedido do PO |
| 09/10/2026 | Plano e tarefas aprovados pelo PO ao pedir a implementação; status `Em implementação` | Decisão humana |
| 09/10/2026 | Implementação concluída (ver [report.md](report.md)) | Implementação |
