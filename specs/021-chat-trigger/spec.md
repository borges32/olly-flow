# Spec 021 — Nó Chat Trigger ("When chat message received")

| Campo | Valor |
|---|---|
| **Status** | Implementada (pendentes: avaliação da Segurança e workflows reais da POC) |
| **Fase** | 4 — Hardening (paridade com o N8N, apoio à migração) |
| **Depende de** | 005, 009, 011, 015, 017 |
| **Requisitos de produto** | PR-16 (parcial), PR-17 (parcial), PR-15 (parcial) |
| **ADRs relacionadas** | 0001, 0008 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

O Agent (spec 011) e o Basic LLM Chain (spec 017) já recebem a pergunta do usuário pelo campo `chatInput` do item. A memória do Agent já identifica a conversa por `sessionId`. Falta o que produz esses campos: um gatilho que recebe mensagens de chat.

Hoje, conversar com um agente do Olly Flow exige montar um webhook e tratar o formato à mão. Também não há como testar a conversa no editor.

No N8N, esse papel é do nó **Chat Trigger** ("When chat message received", `@n8n/n8n-nodes-langchain.chatTrigger`), presente na maioria dos workflows de agentes da POC. Ele oferece:
- **Teste no editor:** um painel de chat que executa o workflow a cada mensagem.
- **Chat hospedado:** uma página de chat pública, servida pela plataforma, depois da publicação.
- **Chat incorporado:** um endereço para sistemas conversarem com o workflow por chamadas HTTP.
- **Sessões:** o mesmo `sessionId` liga as mensagens de uma conversa, e a memória do agente guarda o histórico.

Sem um equivalente, esses workflows chegam à importação como nós marcadores (spec 015). O chat trigger estava no backlog pós go-live ([roadmap](../../docs/roadmap.md)); esta spec o antecipa, a pedido do PO (14/10/2026).

## Histórias de usuário

### HU-1 — Conversar com o workflow no editor (Prioridade: P1)

Como **editor**, quero um painel de chat no editor que envia minhas mensagens ao workflow e mostra as respostas, para testar um agente como o usuário final vai usá-lo.

**Teste independente:** num workflow Chat Trigger → Agent (modelo simulado, memória ligada), enviar duas mensagens pelo painel e conferir as duas respostas, a segunda usando o contexto da primeira.

**Cenários de aceite:**
1. **Dado** um workflow com o Chat Trigger, **quando** abro o painel de chat do editor e envio uma mensagem, **então** o workflow executa em modo teste com o item `{ sessionId, action: "sendMessage", chatInput }`, e a resposta aparece no painel.
2. **Dado** uma conversa aberta no painel, **quando** envio a segunda mensagem, **então** ela usa o mesmo `sessionId`, e um Agent com memória responde com o contexto da conversa.
3. **Dado** o painel aberto, **quando** clico em "Nova sessão", **então** a conversa recomeça com outro `sessionId`.
4. **Dado** uma execução pelo painel, **quando** ela termina, **então** os nós mostram os dados e os passos do agente como em qualquer execução de teste (specs 003, 011), e posso abrir a execução a partir da mensagem.
5. **Dado** um erro na execução, **quando** ele acontece, **então** o painel mostra a mensagem de erro no lugar da resposta.

### HU-2 — Chat hospedado pela plataforma (Prioridade: P1)

Como **editor**, quero publicar o workflow e obter uma página de chat pronta, para entregar o agente aos usuários sem desenvolver uma interface.

**Teste independente:** publicar o workflow com o chat público no modo hospedado, abrir a URL da página, conversar e conferir as execuções de produção.

**Cenários de aceite:**
1. **Dado** o Chat Trigger com "Disponibilizar o chat publicamente" e o modo "Chat hospedado", **quando** publico o workflow, **então** o painel do nó mostra a URL da página de chat, que passa a responder.
2. **Dado** a página aberta, **quando** ela carrega, **então** mostra o título, o subtítulo, as mensagens iniciais, o texto de exemplo do campo e, se configurada, a tela de boas-vindas com o botão de começar, como no N8N.
3. **Dado** uma mensagem enviada pela página, **quando** o workflow termina, **então** a resposta aparece na página, e a execução é registrada como produção com a origem "chat".
4. **Dado** um workflow despublicado, **quando** alguém abre a página ou envia uma mensagem, **então** recebe a indicação de que o chat não está disponível.
5. **Dado** a autenticação configurada, **quando** alguém sem acesso abre a página, **então** não consegue conversar (ver FR-004).

### HU-3 — Chat incorporado em outros sistemas (Prioridade: P1)

Como **desenvolvedor de outro sistema**, quero um endereço de chat com o protocolo do N8N, para integrar o agente a um sistema interno por chamadas HTTP.

**Teste independente:** com o modo "Incorporado", enviar uma mensagem por HTTP no formato do N8N e conferir a resposta.

**Cenários de aceite:**
1. **Dado** o modo "Incorporado", **quando** um sistema envia `{ action: "sendMessage", sessionId, chatInput }` à URL do chat, **então** recebe a resposta no formato do N8N (`{ output }` ou o JSON do nó de resposta).
2. **Dado** origens permitidas configuradas, **quando** uma página de outra origem chama a URL, **então** só as origens da lista são aceitas (CORS), como no webhook (spec 005).
3. **Dado** um sistema que precisa de uma interface de chat, **quando** procura um widget para incorporar em sites, **então** não há: a plataforma não fornece widget nem garante compatibilidade com o `@n8n/chat` (decisão do PO, 14/10/2026). A integração é por HTTP, ou pelo link da página hospedada.

### HU-4 — Retomar a conversa anterior (Prioridade: P2)

Como **usuário do chat**, quero ver as mensagens anteriores ao voltar à página, para continuar a conversa de onde parei.

**Teste independente:** conversar na página hospedada, recarregá-la e conferir o histórico carregado da memória do agente.

**Cenários de aceite:**
1. **Dado** "Carregar sessão anterior" como "Da memória" e uma memória ligada ao Chat Trigger, **quando** a página (ou o widget) volta com o mesmo `sessionId`, **então** as mensagens anteriores são exibidas a partir dessa memória (ação `loadPreviousSession` do N8N).
2. **Dado** "Carregar sessão anterior" como "Não suportado", **quando** a página volta, **então** a conversa começa vazia.
3. **Dado** "Da memória" sem memória ligada, **quando** salvo ou publico, **então** a validação aponta a memória que falta.

### HU-5 — Responder do jeito certo (Prioridade: P1)

Como **editor**, quero escolher de onde vem a resposta do chat, para responder com a saída do agente ou com uma mensagem montada no fluxo.

**Teste independente:** executar o mesmo workflow com cada modo de resposta e conferir a mensagem recebida pelo chat.

**Cenários de aceite:**
1. **Dado** o modo "Quando o último nó terminar", **quando** o workflow termina, **então** o chat recebe a saída do último nó executado: o campo `output` (Agent), ou `text` (Basic LLM Chain), como no N8N.
2. **Dado** o modo "Por nó de resposta", **quando** o fluxo passa pelo nó "Responder ao webhook" (spec 005), **então** o chat recebe o que esse nó definir.
3. **Dado** um workflow que não responde dentro do tempo limite, **quando** o prazo acaba, **então** o chat recebe uma mensagem de erro de tempo esgotado, e a execução segue registrada.
4. **Dado** um Chat Trigger do N8N com resposta em *streaming*, **quando** importo, **então** o modo vira "Quando o último nó terminar", com pendência no relatório: a resposta chega de uma vez (sem *streaming* nesta spec, decisão do PO, 14/10/2026).

### HU-6 — Enviar arquivos pelo chat (Prioridade: P2)

Como **usuário do chat**, quero anexar arquivos à mensagem, para o agente analisar documentos ou imagens.

**Teste independente:** com "Permitir envio de arquivos" e tipos permitidos, anexar um PDF pela página e conferir o binário no item do gatilho.

**Cenários de aceite:**
1. **Dado** "Permitir envio de arquivos" com tipos permitidos (ex.: `image/*,application/pdf`), **quando** anexo um arquivo permitido, **então** o item do gatilho traz o arquivo como binário (`files`), guardado no object storage, como no N8N.
2. **Dado** um tipo não permitido ou um arquivo acima do limite, **quando** tento enviar, **então** o envio é recusado com uma mensagem clara.

### HU-7 — Importar e exportar o gatilho do N8N (Prioridade: P1)

Como **editor que migra do N8N**, quero que o Chat Trigger seja importado com a mesma configuração, para não reconfigurar cada agente.

**Teste independente:** importar um workflow do N8N com Chat Trigger → AI Agent → memória e conferir o gatilho convertido, sem marcador, e a ida e volta pelo arquivo exportado.

**Cenários de aceite:**
1. **Dado** um Chat Trigger do N8N (versões 1 a 1.3), **quando** importo, **então** o nó vem convertido com público ou não, modo, autenticação, mensagens iniciais e opções (título, subtítulo, texto de exemplo, tela de boas-vindas, botão de começar, origens permitidas, arquivos, sessão anterior, modo de resposta).
2. **Dado** o AI Agent ou o Basic LLM Chain com o prompt "Connected Chat Trigger Node" (`promptType: auto`), **quando** importo, **então** eles leem o `chatInput` do gatilho, sem ajuste.
3. **Dado** uma opção sem equivalente (ex.: CSS personalizado da página, autenticação por usuário do N8N), **quando** importo, **então** o relatório da importação mostra a pendência.
4. **Dado** um workflow com o gatilho, **quando** baixo o JSON (spec 015), **então** o nó sai no formato de arquivo da spec 015 (estrutura do N8N, tipo `trigger.chat`), e a reimportação devolve a mesma configuração.

### Casos de borda

- **Mensagens simultâneas na mesma sessão:** a segunda espera a primeira terminar, para a memória não perder contexto (decisão do PO, 14/10/2026; o N8N executa as duas ao mesmo tempo). Se a espera passar do tempo limite de resposta, a mensagem é recusada com o aviso de conversa ocupada.
- **Memória temporária no chat:** a memória temporária (`memory.buffer`, equivalente à "Simple Memory" do N8N) só lembra a conversa dentro de uma execução. No chat, cada mensagem é uma execução, então ela não guarda o contexto entre mensagens; no N8N, a Simple Memory guarda na memória do servidor. O editor e o relatório da importação avisam e indicam a memória persistente (`memory.postgres`).
- **Mensagem vazia ou acima do tamanho máximo:** recusada antes de executar.
- **Abuso do chat público** (muitas mensagens de um mesmo endereço): limitado pela taxa por minuto dos webhooks (spec 005). As chamadas ao modelo seguem o limite mensal de tokens do projeto (spec 011).
- **Workflow com dois Chat Triggers:** a publicação aponta o conflito; um workflow tem no máximo um.
- **Dados pessoais nas conversas (LGPD):** as mensagens são dados de execução e seguem o mascaramento, a política de dados e a retenção (spec 009); o histórico da memória segue a retenção da memória (spec 011).
- **Sessão informada pelo cliente:** o `sessionId` vem do navegador ou do sistema. Quem conhece o `sessionId` de outra pessoa pode carregar a conversa dela com "Carregar sessão anterior". Risco aceito pelo PO, como no N8N (14/10/2026); o `sessionId` gerado pela página hospedada é aleatório e difícil de adivinhar.

## Requisitos funcionais

- **FR-001**: O sistema DEVE oferecer o gatilho Chat Trigger, que emite, para cada mensagem, um item com `sessionId`, `action` (`sendMessage`) e `chatInput`, e os arquivos enviados como binário em `files`, no formato do N8N.
- **FR-002**: O editor DEVE oferecer um painel de chat para workflows com o Chat Trigger, na parte de baixo do editor, ao lado dos logs (FR-016), como no N8N: cada mensagem dispara uma execução de teste, mostra a resposta ou o erro, mantém o `sessionId` da conversa e permite começar uma nova sessão.
- **FR-003**: Com "Disponibilizar o chat publicamente" ligado e o workflow publicado, o sistema DEVE atender o chat:
  - **modo "Chat hospedado":** numa página servida pela plataforma, com título, subtítulo, mensagens iniciais, texto de exemplo, tela de boas-vindas e botão de começar configuráveis;
  - **modo "Incorporado":** num endereço HTTP com o protocolo do N8N (ações `sendMessage` e `loadPreviousSession`) e origens permitidas (CORS).

  Despublicado, o chat DEVE parar de responder.
- **FR-004**: O chat público DEVE oferecer as autenticações do N8N:
  - **"Nenhuma"**;
  - **"Usuário e senha"**: credencial Basic Auth;
  - **"Usuário do Olly Flow"**: qualquer usuário ativo logado na plataforma, equivalente ao "n8n User Auth".

  Como no webhook (spec 005), com `OLLY_REQUIRE_WEBHOOK_AUTH` ligado, a publicação com "Nenhuma" é recusada.
- **FR-005**: O modo de resposta DEVE ser "Quando o último nó terminar" (campo `output` ou `text` do último nó, ou o JSON dele) ou "Por nó de resposta" ("Responder ao webhook"), com tempo limite de resposta e mensagem de erro clara. A spec 027 acrescenta o modo "Streaming" (passo atual enquanto espera e a resposta do último nó no fim).
- **FR-006**: Com "Carregar sessão anterior" em "Da memória", o gatilho DEVE aceitar uma memória ligada a ele e devolver o histórico da sessão na ação `loadPreviousSession`. A validação DEVE exigir a memória.
- **FR-007**: Com "Permitir envio de arquivos", o chat DEVE aceitar anexos dos tipos permitidos, até o limite de tamanho, guardados no object storage como binário do item.
- **FR-008**: As execuções pelo chat público DEVEM ser execuções de produção com a origem "chat", com:
  - o log de execuções e o mascaramento;
  - a política de dados e a retenção (spec 009);
  - a cota do projeto (spec 006);
  - o limite mensal de tokens (spec 011);
  - o workflow de erro (spec 007).
- **FR-009**: O chat público DEVE aplicar limite de taxa por endereço de origem e tamanho máximo de mensagem.
- **FR-010**: Um workflow DEVE ter no máximo um Chat Trigger habilitado; a publicação DEVE recusar mais de um.
- **FR-011**: O Agent e o Basic LLM Chain com o prompt "do item" DEVEM ler o `chatInput` do Chat Trigger, e a memória DEVE usar o `sessionId` dele por padrão, como já fazem (specs 011 e 017).
- **FR-012**: O importador do N8N DEVE converter o Chat Trigger (versões 1 a 1.3) e o prompt `auto` do AI Agent e do Basic LLM Chain; opções sem equivalente DEVEM aparecer como pendências. A exportação DEVE trazer o nó no formato de arquivo da spec 015, com ida e volta sem perda.
- **FR-013**: A documentação do nó DEVE existir em `docs/nos/`, e o catálogo de `docs/nos/workflow-json.md` DEVE incluir o nó, para pessoas e modelos de IA (spec 015).
- **FR-014**: Mensagens da mesma sessão do mesmo workflow DEVEM ser processadas uma de cada vez: a seguinte só executa depois que a anterior responder, terminar ou passar do tempo limite. Se a espera passar do tempo limite de resposta, a mensagem DEVE ser recusada com o aviso de conversa ocupada.
- **FR-015**: Quando o Chat Trigger e uma memória temporária (`memory.buffer`) estão no mesmo workflow, o editor DEVE avisar que o contexto não é guardado entre mensagens, e a importação DEVE registrar a mesma pendência, indicando a memória persistente.
- **FR-016**: O editor DEVE oferecer, na parte de baixo, um painel de **Logs** da execução de teste para qualquer workflow:
  - **lista:** os nós executados na ordem de início, com status, duração e quantidade de itens;
  - **detalhes:** ao escolher um nó, a entrada, a saída, o erro e, nos nós de IA, os passos.

  O painel abre e recolhe, e com o Chat Trigger o chat fica à esquerda dos logs.

## Requisitos não funcionais

- **NFR-001**: A página hospedada e o painel do editor funcionam em celular e computador, em português do Brasil (NFR-G07); o conteúdo configurado (título, mensagens) aparece como digitado.
- **NFR-002**: O tempo entre o fim da execução e a resposta aparecer no chat é de até 1 segundo, com a fila sem carga.
- **NFR-003**: Os testes automatizados usam o modelo simulado (spec 011), sem chamadas a provedores reais.
- **NFR-004**: A página hospedada não expõe dados do workflow além do que foi configurado para ela (sem credenciais ou dados de outras sessões, nem nomes de nós). Exceção (spec 027): no modo de resposta "Streaming", escolhido por quem monta o workflow, a página mostra os nomes dos nós executados (o passo atual).

## Entidades-chave

- **Sessão de chat**: conversa identificada por `sessionId`, com as mensagens trocadas (na memória do agente, quando houver).
- **Mensagem de chat**: texto do usuário, arquivos anexos e a resposta do workflow; cada mensagem gera uma execução.
- **Configuração do chat**: público ou não, modo (hospedado ou incorporado), autenticação, aparência da página, origens permitidas, arquivos, sessão anterior e modo de resposta.

## Critérios de sucesso

- **SC-001**: No editor, uma conversa de 3 mensagens com um Agent com memória (modelo simulado) mostra as 3 respostas, e a terceira usa o contexto das anteriores.
- **SC-002**: Publicado no modo hospedado, a página de chat responde a uma mensagem com a saída do Agent; despublicado, deixa de responder.
- **SC-003**: No modo incorporado, uma chamada HTTP no formato do N8N recebe `{ output }`.
- **SC-006**: Duas mensagens enviadas ao mesmo tempo na mesma sessão executam uma depois da outra, e a segunda resposta usa o contexto da primeira.
- **SC-007**: No editor, depois de uma mensagem do chat (ou de "Executar workflow"), o painel de Logs lista os nós executados na ordem, e escolher o Agent mostra a saída e os passos.
- **SC-004**: Um workflow do N8N com Chat Trigger → AI Agent (prompt `auto`) → memória importa sem nó marcador e responde no painel do editor.
- **SC-005**: Com "Da memória", recarregar a página hospedada mostra o histórico da sessão.

## Fora do escopo

- O hub de chat do N8N ("Available in n8n Chat") e a lista de agentes num portal.
- O nó "Respond to Chat" do N8N (mensagens no meio do fluxo e espera da resposta do usuário), confirmado pelo PO (14/10/2026).
- Widget de chat para sites e compatibilidade com o `@n8n/chat` (decisão do PO, 14/10/2026).
- CSS personalizado da página hospedada (risco de injeção de conteúdo): a página segue o tema do Olly Flow.
- Canais externos (Teams, WhatsApp, Slack).
- *Streaming* das respostas (decisão do PO, 14/10/2026): a resposta chega de uma vez.

## Pré-requisitos humanos

- ~~Responder aos pontos em aberto~~ (respondidos em 14/10/2026).
- Revisar plano e tarefas.
- Segurança: avaliar a exposição pública do chat (autenticação, limite de taxa, CORS) antes da homologação.
- Workflows da POC com Chat Trigger em `fixtures/n8n/`.

## Pontos em aberto

Nenhum. Respondidos pelo PO em 14/10/2026:
1. **Autenticação:** a mesma do N8N (FR-004). "Nenhuma" segue a regra dos webhooks de produção (`OLLY_REQUIRE_WEBHOOK_AUTH`).
2. **Widget para sites:** não é necessário (HU-3).
3. ***Streaming*:** fora do escopo no momento (HU-5).
4. **Mensagens simultâneas na mesma sessão:** a segunda espera a primeira (FR-014).
5. **Sessão pelo `sessionId`:** risco aceito, como no N8N.
6. **"Respond to Chat":** fora do escopo.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 14/10/2026 | Criação da spec, a pedido do PO ("nó When chat message received com as mesmas características do N8N"). Antecipa o item "Chat trigger" do backlog pós go-live | Paridade com o N8N e migração dos workflows de agentes da POC |
| 14/10/2026 | Pontos em aberto respondidos pelo PO: autenticação do N8N (FR-004), com "Nenhuma" sujeita a `OLLY_REQUIRE_WEBHOOK_AUTH` como nos webhooks; sem widget nem compatibilidade com o `@n8n/chat` (HU-3, SC-003); sem *streaming* (HU-5); mensagens da mesma sessão em sequência (FR-014 e SC-006, novos); risco do `sessionId` aceito; "Respond to Chat" fora do escopo. Incluído o aviso sobre a memória temporária no chat (FR-015). Status: Planejada | Esclarecimento |
| 14/10/2026 | Plano e tarefas aprovados pelo PO (pedido de implementação); status: Em implementação | Ciclo SDD |
| 14/10/2026 | Correção na implementação: o arquivo exportado segue o formato da spec 015 (estrutura do N8N com os tipos do Olly Flow, `trigger.chat`), e não o tipo do N8N (HU-7, FR-012) | O formato de arquivo da spec 015 mantém os tipos do Olly Flow em todos os nós; a importação de arquivos do N8N converte o `chatTrigger` |
| 14/10/2026 | Implementação concluída ([relatório](report.md)) | — |
| 14/10/2026 | Pedido do PO (tela do N8N): o chat do editor passa para a parte de baixo, ao lado de um painel de Logs dos nós (FR-002 alterado, FR-016 novo, SC-007 novo) | Testar o fluxo como no N8N, vendo os logs dos nós durante a conversa |
| 14/10/2026 | Painel inferior com chat e logs implementado ([relatório](report.md)) | — |
| 20/10/2026 | NFR-004: no modo de resposta "Streaming" (spec 027), a página hospedada mostra os nomes dos nós executados; nos demais modos, continua sem nomes de nós | Decisão do PO na criação da spec 027 |
| 20/10/2026 | FR-005: modo de resposta "Streaming" (spec 027): a API do chat responde com os passos em NDJSON e a resposta no fim; a página hospedada, a incorporada e o painel do editor mostram o passo atual | Spec 027 |
