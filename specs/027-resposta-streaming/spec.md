# Spec 027 — Resposta em streaming no Webhook e no Chat Trigger

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 4 — Hardening (paridade com o N8N, operação) |
| **Depende de** | 005, 006, 009, 015, 021 |
| **Requisitos de produto** | PR-06 (parcial), PR-17 (parcial), PR-20 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Workflows longos, como os de investigação com vários agentes, levam minutos. Chamados pelo Webhook (spec 005) ou pelo chat (spec 021), quem chama só recebe algo no fim: não sabe se o fluxo está andando, em que passo está, nem se travou. Muitas vezes desiste antes, ou bate no tempo limite de um proxy no caminho.

O N8N resolve isso com o modo de resposta **Streaming** no Webhook e no Chat Trigger. Hoje, o importador do Olly Flow converte esse modo para a resposta de uma vez, com aviso.

O PO pediu (19 e 20/10/2026) que o Webhook vá devolvendo, enquanto o fluxo roda, cada passo executado. As decisões dele:
1. o stream traz **só os passos** (início e fim de cada nó), sem mensagens personalizadas nem texto do modelo aos poucos;
2. **NDJSON**, próximo do formato do N8N;
3. **só metadados**, sem os dados dos nós;
4. os passos dos **sub-workflows não** aparecem;
5. o **Chat Trigger** também ganha o modo;
6. **limite de streams simultâneos por projeto**.

## Histórias de usuário

### HU-1 — Acompanhar os passos de um workflow chamado pelo Webhook (Prioridade: P1)

Como **sistema que chama um workflow**, quero receber cada passo à medida que ele acontece e, no fim, a resposta, para mostrar o progresso a quem espera e saber que o fluxo não travou.

**Teste independente:** publicar um workflow com o Webhook em "Streaming" e três nós, chamá-lo com um cliente que lê a resposta aos poucos, e conferir que os passos chegam antes do fim da execução, na ordem, seguidos da resposta final.

**Cenários de aceite:**
1. **Dado** o Webhook com o modo de resposta "Streaming", **quando** chamo a URL, **então** a resposta começa logo, uma linha JSON por evento: o início da execução, o início e o fim de cada nó executado e, no fim, a resposta, a mesma que o modo "último nó" daria. Cada evento de nó traz o **nome do nó**, como aparece no canvas, para saber em que ponto do workflow a execução está, além do tipo, do status, da duração e da quantidade de itens.
2. **Dado** um nó que falha, **quando** o fluxo termina com erro, **então** chega o fim desse nó com status de erro, um evento de erro com a mensagem e o encerramento do stream.
3. **Dado** o fluxo com o nó "Responder ao webhook", **quando** ele executa, **então** o corpo dele vira a resposta final do stream. Status e cabeçalhos dele não se aplicam, porque a resposta já começou.
4. **Dado** o fluxo rodando, **quando** fica um tempo sem passos novos (um nó demorado), **então** o stream manda um sinal periódico de "ainda rodando", com o nome do nó em execução, para nenhum proxy encerrar a conexão por inatividade.
5. **Dado** a cota de execuções do projeto cheia (spec 006), **quando** a execução fica na fila, **então** o stream informa que ela está na fila e segue quando ela começar.
6. **Dado** um nó Esperar longo (spec 008), **quando** a execução passa a aguardar, **então** o stream informa a espera e encerra; a execução continua.
7. **Dado** que quem chamou desconecta, **quando** o fluxo ainda está rodando, **então** a execução continua normalmente e a vaga do stream é liberada.

### HU-2 — Ver os passos no chat (Prioridade: P1)

Como **pessoa que conversa com um workflow**, quero ver em que passo a resposta está enquanto espero, para saber que ela está vindo.

**Teste independente:** com o Chat Trigger em "Streaming", mandar uma mensagem no chat hospedado e conferir que o passo atual aparece enquanto o fluxo roda, e depois a resposta.

**Cenários de aceite:**
1. **Dado** o Chat Trigger com o modo "Streaming", **quando** mando uma mensagem pelo chat hospedado ou incorporado, **então** vejo o passo atual (o nó em execução) enquanto espero e, no fim, a resposta, como no modo "último nó".
2. **Dado** o painel de chat do editor (spec 021, FR-002), **quando** o gatilho está em "Streaming", **então** o painel mostra o passo atual do mesmo jeito.
3. **Dado** um erro no fluxo, **quando** a execução falha, **então** o chat mostra o erro, como hoje.
4. **Dado** a API do chat (`POST …/chat`) chamada por outro sistema, **quando** o modo é "Streaming", **então** a resposta é o mesmo stream NDJSON do Webhook.

### HU-3 — Limitar os streams por projeto (Prioridade: P1)

Como **administrador da plataforma**, quero limitar quantos streams cada projeto mantém abertos ao mesmo tempo, para que conexões longas não esgotem a capacidade da API.

**Teste independente:** definir o limite 1 num projeto, abrir um stream e conferir que o segundo é recusado até o primeiro terminar.

**Cenários de aceite:**
1. **Dado** o limite do projeto atingido, **quando** chega uma nova chamada em "Streaming" (Webhook ou chat), **então** ela é recusada na hora, com a mensagem de limite de streams, e nenhuma execução é criada.
2. **Dado** um stream que termina, falha ou é desconectado, **quando** chega a próxima chamada, **então** a vaga já está livre.
3. **Dado** um projeto sem limite próprio, **quando** recebe streams, **então** vale o limite padrão da plataforma.
4. **Dado** a administração da plataforma, **quando** altero o limite de um projeto, **então** a alteração vale para as próximas chamadas e fica na auditoria.

### HU-4 — Importar o modo do N8N (Prioridade: P2)

Como **quem migra do N8N**, quero que o Webhook e o Chat Trigger em "Streaming" sejam importados nesse modo.

**Cenários de aceite:**
1. **Dado** um workflow do N8N com o Webhook ou o Chat Trigger em "Streaming", **quando** importo, **então** o nó fica em "Streaming", sem o aviso de hoje.
2. **Dado** que no N8N o stream traz o texto dos nós que suportam streaming (ex.: Agent), **quando** importo, **então** a importação avisa que, no Olly Flow, o stream traz os passos, e a resposta completa chega no fim.

### Casos de borda

- **Escuta de teste** (`/webhook-test`, spec 005): o modo vale também na chamada de teste; o canvas continua mostrando o progresso como hoje.
- **Sub-workflows:** o nó "Executar workflow" aparece como um passo; os passos do sub-workflow não.
- **Sub-nós de IA** (modelo, memória, ferramentas): não aparecem como passos; executam dentro do nó pai.
- **Nós que não executam** (ramo sem itens): não aparecem.
- **Laços:** cada execução do nó no laço é um passo, com o número da iteração.
- **Tempo:** o stream dura até a execução terminar, limitado pelo tempo máximo do workflow; o tempo limite de resposta síncrona (`OLLY_WEBHOOK_RESPONSE_TIMEOUT`) não encerra o stream.
- **Cliente sem leitura aos poucos:** recebe o conteúdo inteiro no fim, como linhas JSON.

## Requisitos funcionais

- **FR-001**: O Webhook DEVE oferecer o modo de resposta "Streaming", em que a resposta é enviada aos poucos, uma linha JSON por evento (NDJSON), no formato do N8N (tipos `begin`, `item`, `end`, `error`), acrescido dos eventos de ciclo de vida da execução e do sinal periódico, que clientes devem poder ignorar.
- **FR-002**: O stream DEVE trazer, na ordem: o início da execução (com o identificador), o início e o fim de cada nó executado, os avisos de fila e de espera, e por fim a resposta final, a mesma do modo "último nó" ou o corpo do "Responder ao webhook", ou o erro. Depois disso, o stream é encerrado. Todo evento ligado a um nó DEVE trazer o **nome do nó** como aparece no canvas (com o identificador, o tipo e a iteração): o início e o fim de cada nó (também com status, duração e quantidade de itens), o sinal periódico (o nó em execução), a resposta final (o nó que a produziu) e o erro (o nó que falhou, quando houver).
- **FR-003**: O stream NÃO DEVE trazer entrada, saída, console nem binários dos nós, nem os passos de sub-workflows e de sub-nós. A resposta final é a única parte com dados, como nos demais modos.
- **FR-004**: O stream DEVE mandar um sinal periódico enquanto não houver passos novos, e terminar quando a execução terminar ou passar a aguardar. A desconexão de quem chamou NÃO DEVE interromper a execução.
- **FR-005**: O Chat Trigger DEVE oferecer o modo "Streaming": a API do chat responde com o mesmo stream, e o chat hospedado, o incorporado e o painel do editor mostram o passo atual enquanto esperam e a resposta no fim.
- **FR-006**: Cada projeto DEVE ter um limite de streams abertos ao mesmo tempo (Webhook e chat somados), com padrão da plataforma e valor próprio definido pela administração da plataforma (auditado). Acima do limite, a chamada DEVE ser recusada antes de criar a execução, com mensagem clara.
- **FR-007**: A autenticação, a allowlist de IP, o limite de taxa, o CORS e a publicação do Webhook e do chat DEVEM valer igual no modo "Streaming". Com o "Responder ao webhook" no fluxo, a publicação DEVE avisar que status e cabeçalhos dele são ignorados nesse modo.
- **FR-008**: O importador do N8N DEVE converter o modo "Streaming" do Webhook e do Chat Trigger, com aviso de que o stream traz os passos, e não o texto dos nós.
- **FR-009**: A documentação DEVE descrever o formato do stream, com exemplos de consumo (curl, Python, JavaScript) e a configuração necessária nos proxies (sem buffer e com tempo limite).

## Requisitos não funcionais

- **NFR-001**: Cada passo chega a quem chamou em até 1 segundo depois de acontecer, com a plataforma sem carga.
- **NFR-002**: O stream funciona com várias instâncias da API e dos workers (spec 006): qualquer instância pode atender a chamada, e nenhum passo se perde ou chega fora de ordem.
- **NFR-003**: Interface em português do Brasil (NFR-G07).

## Entidades-chave

- **Projeto:** ganha o limite próprio de streams simultâneos (opcional).
- **Evento do stream:** tipo, metadados do passo (nome e identificador do nó, tipo, iteração, status, duração, itens, horário) e, no último, a resposta ou o erro.

## Critérios de sucesso

- **SC-001**: Num workflow publicado com três nós de 1 segundo cada, chamado pelo Webhook em "Streaming", o cliente recebe o fim do primeiro nó antes do início do terceiro, e a resposta final igual à do modo "último nó".
- **SC-002**: Com duas instâncias da API e dois workers, cem chamadas em "Streaming" recebem todos os passos, na ordem.
- **SC-003**: Com limite 1 no projeto, a segunda chamada simultânea é recusada sem criar execução, e é aceita depois que a primeira termina.
- **SC-004**: No chat hospedado em "Streaming", o passo atual aparece enquanto o fluxo roda, e a resposta no fim.

## Fora do escopo

- Texto do modelo aos poucos (tokens do Agent, do Basic LLM Chain, do Bridge ou do Agentix).
- Mensagens personalizadas no meio do fluxo (nó "Enviar ao stream").
- Dados dos nós no stream.
- Passos de sub-workflows.
- SSE (`text/event-stream`) e WebSocket público.

## Pré-requisitos humanos

- **Infra:** nos ambientes com proxies além dos do `k3s/`, conferir que não bufferizam a resposta e que o tempo limite comporta os fluxos longos. O do `k3s/` é ajustado por esta spec.
- **Segurança:** ciência de que os nomes dos nós passam a aparecer para quem chama um Webhook ou chat em "Streaming" (decisão do PO em 20/10/2026; spec 021, NFR-004).

## Pontos em aberto

Nenhum. Resolvido em 20/10/2026: nomes dos nós no chat público (spec 021, NFR-004). O PO decidiu permitir. No modo "Streaming", escolhido por quem monta o workflow, os nomes dos nós executados aparecem para quem chama, inclusive na página hospedada do chat. A NFR-004 da spec 021 foi atualizada, e o campo do modo avisa isso.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 20/10/2026 | Criação da spec, com as decisões do PO (só passos, NDJSON próximo do N8N, só metadados, sem sub-workflows, Chat Trigger incluído, limite por projeto) | Avaliação de 19/10/2026: viável como modo de resposta, em vez de nó novo |
| 20/10/2026 | Ponto em aberto resolvido: nomes dos nós permitidos no modo Streaming, inclusive no chat público (NFR-004 da spec 021 atualizada). Plano e tarefas criados. Status: Planejada | Decisão do PO |
| 20/10/2026 | FR-002: o nome do nó (como no canvas) explícito em todo evento ligado a um nó, inclusive no sinal periódico (nó em execução) e na resposta final (nó que a produziu) | Pedido do PO: saber em que ponto do workflow a execução está |
| 20/10/2026 | Implementação concluída ([relatório](report.md)) | — |
