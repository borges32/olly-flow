# Spec 017 — Nó Basic LLM Chain

| Campo | Valor |
|---|---|
| **Status** | Planejada |
| **Fase** | 4 — Hardening (paridade com o N8N, apoio à migração) |
| **Depende de** | 011, 015, 016 |
| **Requisitos de produto** | PR-16 (parcial), PR-17 (parcial) |
| **ADRs relacionadas** | 0001, 0008 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Hoje, a única forma de usar um modelo de linguagem num workflow do Olly Flow é o **Agent** (spec 011). O Agent raciocina em ciclos, chama ferramentas, usa memória e registra cada passo. Muitos usos não precisam disso: só uma chamada ao modelo com um prompt montado a partir do item. Exemplos:
- resumir um texto;
- classificar um chamado;
- extrair campos de um e-mail;
- traduzir;
- gerar um título.

No N8N, esse papel é do nó **Basic LLM Chain** (`@n8n/n8n-nodes-langchain.chainLlm`). Ele faz **uma chamada** ao modelo ligado à entrada de modelo, com:
- um prompt do item ou definido no nó;
- mensagens de sistema e de exemplo opcionais;
- opcionalmente, uma resposta num formato estruturado.

Por ser mais simples e barato que o Agent, ele é comum nos workflows da POC. Sem um equivalente:
- esses workflows chegam à importação como nós marcadores (spec 015);
- quem os migra precisa reescrevê-los com um Agent, mais caro e menos previsível.

## Histórias de usuário

### HU-1 — Chamar o modelo com um prompt (Prioridade: P1)

Como **editor**, quero um nó que envia um prompt ao modelo de chat ligado a ele e devolve a resposta, para resumir, classificar, extrair ou gerar texto sem montar um agente.

**Teste independente:** com um modelo simulado ligado ao nó, executar um workflow com dois itens e conferir que cada item gerou uma chamada com o prompt do item e uma saída com o texto da resposta.

**Cenários de aceite:**
1. **Dado** um nó com o prompt "definido no nó" (com expressões) e um modelo de chat ligado, **quando** o workflow executa, **então** cada item gera uma chamada ao modelo com o prompt resolvido para aquele item e uma saída com o texto da resposta.
2. **Dado** o prompt "do item" (campo `chatInput`, como no gatilho de chat do N8N), **quando** o item não tem o campo, **então** o item falha com uma mensagem que diz o que falta.
3. **Dado** mensagens adicionais (sistema, exemplos de usuário e de resposta do modelo), **quando** o nó executa, **então** elas vão ao modelo na ordem definida, antes do prompt.
4. **Dado** um Bridge Chat Model (spec 016) ou um Modelo de chat (spec 011), **quando** está ligado ao nó, **então** o nó funciona igual, com a governança de cada um (lista de modelos permitidos, quando houver, e limite mensal de tokens).
5. **Dado** nenhum modelo ligado, ou mais de um, **quando** salvo ou executo, **então** a validação aponta o problema, como no Agent.

### HU-2 — Resposta em formato estruturado (Prioridade: P1)

Como **editor**, quero exigir que a resposta siga um formato (objeto JSON com campos definidos), para usar os campos nos nós seguintes sem tratar texto livre.

**Teste independente:** com o modelo simulado, pedir uma resposta que segue o formato e outra que não segue, e conferir a saída estruturada no primeiro caso e a correção ou a falha no segundo.

**Cenários de aceite:**
1. **Dado** um formato definido, **quando** o modelo responde dentro dele, **então** a saída traz o objeto com os campos, e não o texto.
2. **Dado** uma resposta fora do formato, **quando** ela chega, **então** o nó pede a correção ao modelo, como no Agent (spec 011, SC-007), e falha com uma mensagem clara se não houver correção.

### HU-3 — Uso e custo, como nos demais nós de IA (Prioridade: P1)

Como **administrador**, quero que as chamadas do nó contem no uso, no custo e no limite mensal de tokens do projeto, para manter a governança de IA da spec 011.

**Teste independente:** executar o nó e conferir o uso registrado (provedor, modelo, tokens) e o bloqueio quando o limite mensal do projeto foi atingido.

**Cenários de aceite:**
1. **Dado** uma execução do nó, **quando** o modelo responde, **então** o uso e o custo estimado são registrados por chamada, com o nó e a execução.
2. **Dado** o limite mensal do projeto atingido, **quando** o nó vai chamar o modelo, **então** a chamada é bloqueada com a mensagem do limite.

### HU-4 — Modelo reserva (Prioridade: P2)

Como **editor**, quero ligar um segundo modelo ao nó, usado quando o principal falha, para que uma indisponibilidade do provedor não interrompa o workflow.

**Teste independente:** com um modelo principal que falha e um reserva que responde, conferir que a saída vem do reserva e que a execução mostra a troca.

**Cenários de aceite:**
1. **Dado** o modelo reserva ligado e habilitado no nó, **quando** a chamada ao principal falha (depois das novas tentativas dele), **então** a mesma chamada é feita ao modelo reserva e a saída vem dele.
2. **Dado** o principal e o reserva falhando, **quando** o nó executa, **então** o item falha com o erro do reserva, citando também a falha do principal.
3. **Dado** o modelo reserva habilitado no nó sem nenhum modelo ligado à entrada de reserva, **quando** salvo ou executo, **então** a validação aponta o problema.
4. **Dado** uma chamada atendida pelo reserva, **quando** vejo o uso e os passos da execução, **então** eles mostram o provedor e o modelo do reserva.

### HU-5 — Ver a chamada no painel da execução (Prioridade: P2)

Como **editor**, quero ver no painel do nó, durante e depois da execução, as mensagens enviadas ao modelo e a resposta de cada item, como nos passos do Agent, para entender e ajustar o prompt.

**Teste independente:** executar o nó e conferir os passos do item (mensagens enviadas, resposta, tokens, correções e troca para o reserva) no painel e na API dos passos.

**Cenários de aceite:**
1. **Dado** uma execução do nó, **quando** abro o painel do nó, **então** vejo, por item, a chamada (mensagens e resposta, com os tokens), as correções do formato, quando houver, e a resposta final.
2. **Dado** dados sensíveis no prompt, **quando** os passos são gravados e transmitidos, **então** o mascaramento do projeto (spec 009) é aplicado, como nos passos do Agent.

### HU-6 — Migrar o Basic LLM Chain do N8N (Prioridade: P2)

Como **editor**, quero importar workflows do N8N com o Basic LLM Chain, para que ele chegue convertido em vez de virar um nó marcador.

**Teste independente:** importar, no formato N8N, um workflow com o Basic LLM Chain ligado a um modelo e conferir o tipo, o prompt, as mensagens e as conexões convertidas.

**Cenários de aceite:**
1. **Dado** um `chainLlm` do N8N com o prompt, as mensagens e o modelo ligado, **quando** importo, **então** o nó é convertido com os mesmos parâmetros e conexões.
2. **Dado** um `chainLlm` com "Require Specific Output Format" e um Structured Output Parser ligado, **quando** importo, **então** o schema do parser vai para o formato do nó e o parser não vira um nó marcador.
3. **Dado** um `chainLlm` com modelo reserva ligado, **quando** importo, **então** o modelo reserva chega ligado à entrada de reserva.
4. **Dado** um `chainLlm` com algo fora do escopo (mensagem com imagem, processamento em lotes, outro tipo de output parser), **quando** importo, **então** o relatório da importação avisa o que não foi convertido.

### Casos de borda

- **Prompt vazio depois de resolver as expressões:** o item falha citando o parâmetro.
- **Vários itens de entrada:** uma chamada por item, e a saída mantém a ligação com o item de origem. Com o tratamento de erro "continuar" ou "saída de erro", o item que falha não interrompe os demais.
- **Resposta vazia do modelo:** a saída traz o texto vazio, sem erro.
- **Resposta em blocos** (provedores que devolvem campos extras, como a Bridge): a saída traz o texto, não o JSON dos blocos.
- **Cancelamento ou tempo limite da execução:** a chamada em andamento é interrompida.
- **Modelo indisponível ou erro do provedor:** o item falha com a mensagem do provedor, valendo as novas tentativas configuradas no modelo. Com o reserva ligado, a chamada passa para ele.
- **Limite mensal de tokens atingido:** não aciona o modelo reserva: o item falha com a mensagem do limite.
- **Cancelamento durante a chamada ao principal:** não aciona o modelo reserva.
- **Resposta fora do formato:** as correções usam o mesmo modelo que respondeu (principal ou reserva).

## Requisitos funcionais

- **FR-001**: DEVE existir o nó **Basic LLM Chain**. Ele DEVE ter entrada e saída principais e a entrada de modelo, que exige exatamente um modelo de chat ligado (o Modelo de chat da spec 011 ou o Bridge Chat Model da spec 016).
- **FR-002**: O nó DEVE fazer **uma chamada ao modelo por item**, sem ferramentas, memória ou ciclos de raciocínio. O prompt pode vir:
  - do campo `chatInput` do item;
  - de um texto definido no nó, com expressões.
- **FR-003**: O nó DEVE aceitar **mensagens adicionais** de texto antes do prompt, cada uma com um papel: sistema, usuário (exemplo) ou modelo (exemplo de resposta), com expressões. Mensagens com imagem (do binário do item ou por URL) NÃO fazem parte desta spec.
- **FR-004**: Sem formato definido, a saída de cada item DEVE trazer o texto da resposta no campo **`text`**, como no N8N, para que as expressões `$json.text` dos workflows migrados continuem valendo.
- **FR-005**: O formato estruturado DEVE ser definido por um **JSON Schema no próprio nó**, como no Agent. Com formato definido, a saída DEVE trazer o objeto que segue o schema no campo `output`. QUANDO a resposta não seguir o formato, o nó DEVE pedir a correção ao modelo no máximo 2 vezes e então falhar, como o Agent (spec 011).
- **FR-006**: As chamadas DEVEM seguir a governança de IA da spec 011:
  - lista de modelos permitidos (para os modelos que a usam);
  - limite mensal de tokens do projeto;
  - registro do uso e do custo por chamada.
- **FR-007**: O tratamento de erro do nó ("parar", "continuar" ou "saída de erro") DEVE valer por item.
- **FR-008**: A importação do N8N (spec 015) DEVE converter o `chainLlm` (prompt, mensagens de texto, conexão do modelo e do modelo reserva) para o novo nó. O Structured Output Parser ligado a ele DEVE virar o JSON Schema do nó, sem gerar um nó. O que não tiver equivalente (imagens, lotes, outros output parsers) DEVE ir para o relatório da importação.
- **FR-009**: A documentação DEVE incluir a página do nó em `docs/nos/` e o novo tipo na documentação do formato JSON (spec 015, FR-021).
- **FR-010**: Segredos das credenciais do modelo NÃO DEVEM aparecer na saída, nos dados de execução, nos passos ou nos logs (como na spec 011).
- **FR-011**: O nó DEVE permitir habilitar um **modelo reserva** (fallback), que acrescenta uma segunda entrada de modelo. QUANDO a chamada ao modelo principal falhar, a mesma chamada DEVE ser feita ao reserva. O limite mensal de tokens e o cancelamento NÃO DEVEM acionar o reserva. O uso e os passos DEVEM indicar o modelo que respondeu.
- **FR-012**: Cada chamada ao modelo DEVE ser registrada como **passo da execução**, por item, como no Agent: as mensagens enviadas, a resposta, os tokens, as correções do formato, a troca para o reserva e a resposta final. Os passos DEVEM aparecer no painel do nó, em tempo real e depois da execução, com o mascaramento do projeto (spec 009).

## Requisitos não funcionais

- **NFR-001**: Além da chamada ao modelo, o nó não deve acrescentar latência perceptível (sem ciclos nem chamadas extras quando a resposta não exige correção).
- **NFR-002**: Toda a verificação automatizada usa o modelo simulado (spec 011) ou a Bridge simulada (spec 016): os testes não dependem de provedores reais.

## Entidades-chave

- **Prompt:** texto enviado ao modelo para cada item, vindo do item ou definido no nó.
- **Mensagem adicional:** papel (sistema, usuário ou modelo) e texto, enviados antes do prompt.
- **Formato da resposta:** JSON Schema que a resposta deve seguir quando a saída é estruturada.
- **Modelo reserva:** segundo modelo de chat, usado quando a chamada ao principal falha.
- **Passo:** registro de uma chamada ao modelo (mensagens, resposta, tokens) ou da resposta final de um item.

## Critérios de sucesso

- **SC-001**: Com o modelo simulado, um workflow com o nó processa vários itens. Cada item gera uma chamada com o prompt e as mensagens na ordem, e uma saída com o texto, ligada ao item de origem.
- **SC-002**: Com o formato definido, a resposta correta vira um objeto. A resposta fora do formato é corrigida ou falha depois de 2 tentativas.
- **SC-003**: O uso e o custo de cada chamada aparecem no consumo de IA do projeto, e o limite mensal bloqueia novas chamadas.
- **SC-004**: O nó funciona com o Modelo de chat (spec 011) e com o Bridge Chat Model (spec 016).
- **SC-005**: Um workflow do N8N com o Basic LLM Chain, um Structured Output Parser e um modelo reserva é importado sem nós marcadores (fixture sintética e, quando houver, os workflows reais da POC).
- **SC-006**: Com o principal falhando, a saída vem do modelo reserva, e o uso e os passos mostram o modelo que respondeu.
- **SC-007**: Os passos de cada item (mensagens, resposta, tokens, correções e resposta final) aparecem no painel do nó e na API dos passos, mascarados.

## Fora do escopo

- Ferramentas, memória e ciclos de raciocínio: são do Agent (spec 011).
- Outras chains do N8N (Question and Answer Chain, Summarization Chain, Retrieval) e recuperação de documentos (RAG).
- Respostas em streaming para o usuário final, já que o Olly Flow não tem gatilho de chat.
- Mensagens com imagem (binário do item ou URL) — decisão do PO em 09/10/2026.
- Processamento em lotes (itens por vez e espera entre os lotes): vale a execução paralela por item da spec 006 — decisão do PO em 09/10/2026.
- Sub-nós de output parser: o formato é um JSON Schema no nó — decisão do PO em 09/10/2026.

## Pré-requisitos humanos

- Exemplos de workflows da POC com o Basic LLM Chain em `fixtures/n8n/`, para o SC-005.
- Respostas aos pontos em aberto abaixo.

## Pontos em aberto

- Nenhum. (Respondidos pelo PO em 09/10/2026; ver o histórico.)

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 09/10/2026 | Criação | Pedido do PO: nó com a funcionalidade do Basic LLM Chain do N8N |
| 09/10/2026 | Esclarecimentos do PO: (1) campo da saída `text`, como no N8N (FR-004); (2) formato por JSON Schema no nó, com o objeto em `output` (FR-005); (3) sem imagens nas mensagens (FR-003, fora do escopo); (4) modelo reserva como no N8N (HU-4, FR-011, SC-006); (5) sem processamento em lotes (fora do escopo); (6) passos da execução no painel, como no Agent (HU-5, FR-012, SC-007). A antiga HU-4 (migração) virou HU-6, com o parser estruturado e o reserva | Decisão humana |
