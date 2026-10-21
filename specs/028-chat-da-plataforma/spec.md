# Spec 028 — Chat da plataforma ("Olly Chat")

| Campo | Valor |
|---|---|
| **Status** | Implementada |
| **Fase** | 4 — Hardening (produto: assistente para os usuários) |
| **Depende de** | 002, 009, 014, 021, 027 |
| **Requisitos de produto** | PR-15 (parcial), PR-16 (parcial), PR-19 (parcial) |
| **ADRs relacionadas** | 0001 |

> Descreva **o quê** e **por quê**. Não inclua decisões de implementação (bibliotecas, tabelas, classes): elas pertencem ao `plan.md`.

## Contexto e problema

Os workflows de IA (ex.: investigação de problemas com agentes) hoje são acionados por sistemas externos ou pelo chat público de um workflow (spec 021). Não há, dentro da própria plataforma, um lugar onde qualquer usuário autenticado converse com o assistente da organização, com as conversas organizadas e retomáveis.

O PO pediu (21/10/2026) uma tela de chat na plataforma:
- **Acesso:** ícone no menu lateral e página própria, para qualquer usuário autenticado, de qualquer perfil.
- **Sessões:** numeradas, listadas numa barra lateral, que o usuário retoma ou cria quando quiser.
- **Destino:** cada mensagem vai para um workflow configurado, por um Webhook em modo **Streaming** (spec 027), com a identidade do usuário logado.
- **Configuração:** na plataforma, a URL do webhook e o tempo de retenção das sessões.

## Histórias de usuário

### HU-1 — Conversar com o assistente (Prioridade: P1)

Como **usuário autenticado**, quero mandar uma mensagem no chat da plataforma e ver a resposta do workflow, acompanhando o progresso, para tirar dúvidas e pedir análises sem sair da plataforma.

**Teste independente:** com o chat configurado, abrir **Olly Chat** no menu, mandar "Analise se estamos com algum problema com o mobile pf" e conferir que o workflow recebe o payload com a sessão, os dados do usuário e a mensagem, e que a resposta aparece.

**Cenários de aceite:**
1. **Dado** um usuário autenticado de qualquer perfil, **quando** abre o menu, **então** vê o item **Olly Chat** com ícone, que leva à página do chat.
2. **Dado** a página do chat, **quando** o usuário envia uma mensagem, **então** o workflow configurado recebe:
   ```json
   {
     "chatSessionId": "<número da sessão>",
     "client": "chat-olly",
     "email": "<e-mail do usuário logado>",
     "login": "<login do usuário logado>",
     "name": "<nome do usuário logado>",
     "message": "<texto digitado>"
   }
   ```
3. **Dado** o envio, **quando** o workflow está processando, **então** o chat mostra o passo atual (o nó em execução, informado pelo streaming) e, no fim, a resposta, com formatação (Markdown).
4. **Dado** uma resposta em andamento, **quando** o usuário tenta mandar outra mensagem na mesma sessão, **então** o envio fica bloqueado até a resposta chegar.
5. **Dado** uma falha (workflow com erro, webhook indisponível, limite de streams atingido, tempo esgotado), **quando** ela acontece, **então** o chat mostra uma mensagem de erro clara na conversa, e o usuário pode tentar de novo.

### HU-2 — Organizar e retomar sessões (Prioridade: P1)

Como **usuário**, quero ter várias sessões numeradas numa barra lateral, para separar assuntos e voltar a uma conversa anterior.

**Teste independente:** criar duas sessões, conversar nas duas, recarregar a página e conferir que as duas aparecem na barra lateral, com o histórico de cada uma.

**Cenários de aceite:**
1. **Dado** a página do chat, **quando** clico em **Nova sessão**, **então** uma sessão vazia é criada com o próximo número das minhas sessões (1, 2, 3…), com o título "Sessão N", aparece no topo da barra lateral e fica selecionada. Depois da primeira mensagem, o título passa a ser "Sessão N · <começo da mensagem>".
2. **Dado** sessões existentes, **quando** escolho uma na barra lateral, **então** vejo todas as mensagens dela (minhas e as respostas), na ordem, e as próximas mensagens vão com o número dela no `chatSessionId`.
3. **Dado** que saio da plataforma e volto outro dia, **quando** abro o chat, **então** minhas sessões ainda estão lá (dentro do tempo de retenção).
4. **Dado** outro usuário, **quando** ele abre o chat, **então** não vê as minhas sessões.
5. **Dado** a primeira visita (sem sessões), **quando** abro o chat, **então** uma sessão nova já está pronta para a primeira mensagem.
6. **Dado** uma sessão, **quando** a renomeio, **então** o novo título aparece na barra lateral; **quando** a excluo (com confirmação), **então** ela e as mensagens dela somem. O número dela não é reaproveitado.

### HU-3 — Configurar o chat (Prioridade: P1)

Como **administrador da plataforma**, quero configurar a URL do webhook que alimenta o chat e o tempo de retenção das sessões, para ligar o chat ao workflow certo e cumprir a política de dados.

**Teste independente:** na aba **Olly Chat** da Administração, salvar a URL de um webhook em "Streaming" e a retenção de 7 dias, mandar uma mensagem no chat e conferir que ela chega a esse webhook.

**Cenários de aceite:**
1. **Dado** a aba **Olly Chat** da Administração, **quando** informo a URL do webhook, o tempo de retenção e, se o webhook exigir, a autenticação (cabeçalho com chave ou Basic) e salvo, **então** as próximas mensagens vão para essa URL com essa autenticação, e a alteração fica na auditoria. Os segredos da autenticação não voltam para a tela depois de salvos.
2. **Dado** uma URL inválida (não HTTP ou HTTPS) ou uma retenção fora dos limites, **quando** salvo, **então** a tela mostra o erro e não salva.
3. **Dado** o chat sem configuração, **quando** um usuário abre a página, **então** vê o aviso de que o chat ainda não foi configurado, sem conseguir enviar.
4. **Dado** quem não é administrador da plataforma, **quando** tenta abrir a configuração, **então** não consegue (a tela não aparece e a API recusa).

### HU-4 — Retenção das sessões (Prioridade: P2)

Como **responsável pelos dados (LGPD)**, quero que as sessões do chat sejam apagadas depois do tempo configurado, para não guardar conversas além do necessário.

**Cenários de aceite:**
1. **Dado** a retenção de N dias (padrão 7), **quando** a última mensagem de uma sessão fica mais antiga que N dias, **então** a sessão e as mensagens dela são apagadas automaticamente e somem da barra lateral. Uma sessão antiga que recebe uma mensagem nova volta a contar o prazo a partir dela.
2. **Dado** a retenção alterada, **quando** a limpeza seguinte roda, **então** vale o novo prazo para todas as sessões.

### Casos de borda

- **Usuário sem e-mail ou sem nome no cadastro** (ex.: vindo do IdP sem esses dados): o campo vai vazio, e o envio funciona.
- **Resposta que não é streaming** (o webhook responde de uma vez, com JSON ou texto): a resposta aparece normalmente, sem o passo atual.
- **Resposta sem texto** (JSON sem `output` nem `text`): o chat mostra o JSON formatado.
- **Usuário desativado ou sessão de login expirada:** volta ao login, como no resto da plataforma.
- **Várias abas abertas:** a mesma sessão em duas abas mostra o histórico atualizado ao recarregar; o bloqueio de envio vale por sessão.
- **Configuração trocada com conversas abertas:** as próximas mensagens vão para a URL nova; o histórico continua.

## Requisitos funcionais

- **FR-001**: A plataforma DEVE ter o item **Olly Chat**, com ícone, no menu lateral, visível a todo usuário autenticado (de qualquer perfil, inclusive sem projeto), levando à página do chat.
- **FR-002**: A página do chat DEVE ter a barra lateral com as sessões do usuário (número e título, das mais recentes para as mais antigas), o botão **Nova sessão** e a conversa da sessão selecionada.
- **FR-003**: Cada sessão DEVE ter um número sequencial **por usuário** (1, 2, 3…), gerado pela plataforma, enviado como texto no `chatSessionId` de todas as mensagens dela. Um número NÃO DEVE ser reaproveitado, nem depois de excluir a sessão.
- **FR-004**: Cada mensagem DEVE ser enviada ao webhook configurado com o payload `{ chatSessionId, client: "chat-olly", email, login, name, message }`. `email`, `login` e `name` DEVEM vir do usuário autenticado, e NÃO DEVEM poder ser alterados pelo usuário nem pela página. O `login` DEVE ser o nome de usuário do provedor de identidade (IdP), quando houver; senão, o e-mail.
- **FR-005**: O chat DEVE consumir a resposta em streaming (formato da spec 027), mostrando o passo atual enquanto espera e a resposta no fim (Markdown); uma resposta comum (JSON ou texto, de uma vez) DEVE ser mostrada também. O workflow devolve no fim um JSON como `[ { "client": "chat-olly", "report": "<Markdown>", "memoria": {} } ]` (lista ou objeto): o texto exibido DEVE ser o campo **`report`**; sem ele, `output` ou `text`, ou o JSON formatado. O mesmo JSON DEVE ser reconhecido quando chega como texto (ex.: Responder ao Webhook em "Texto" ou `output` de um Agent com o JSON, inclusive num bloco ```json).
- **FR-012**: O Markdown da resposta DEVE seguir o padrão do GitHub (GFM): tabelas, tachado, listas de tarefas e links automáticos, além de títulos (`#` a `####`), citações e linhas horizontais com formatação visível. Uma tabela larga DEVE rolar na horizontal dentro da mensagem.
- **FR-011**: O Markdown da resposta DEVE mostrar como diagrama os blocos ` ```mermaid ` (ao menos o flowchart); um diagrama inválido DEVE aparecer como o código, com o aviso do erro, sem quebrar a mensagem.
- **FR-006**: As mensagens do usuário e as respostas (ou os erros) DEVEM ficar guardadas na sessão, para o usuário voltar a ela a qualquer momento. Cada usuário DEVE ver só as próprias sessões e PODE renomeá-las ou excluí-las (com confirmação).
- **FR-007**: Numa sessão, só uma mensagem DEVE ficar em andamento por vez; o envio fica bloqueado até a resposta, o erro ou o tempo limite.
- **FR-008**: A configuração do chat DEVE ficar numa aba **Olly Chat** da Administração, só para o administrador da plataforma, com: a URL do webhook (qualquer URL HTTP ou HTTPS, respeitando o filtro de rede), o tempo de retenção das sessões (dias, padrão 7, de 1 a 3650) e a autenticação opcional do webhook (nenhuma, cabeçalho com chave ou Basic). Os segredos DEVEM ser guardados criptografados e NÃO DEVEM voltar à tela nem aparecer em logs. Cada alteração DEVE ficar na auditoria. Sem URL configurada, o chat DEVE avisar que não está disponível.
- **FR-009**: Sessões cuja última mensagem for mais antiga que o tempo de retenção DEVEM ser apagadas automaticamente, com as mensagens. Uma mensagem nova renova o prazo da sessão.
- **FR-010**: Falhas DEVEM aparecer na conversa com mensagem clara: chat não configurado, webhook indisponível ou recusando a chamada, limite de streams do projeto (spec 027), erro do workflow e tempo esgotado.

## Requisitos não funcionais

- **NFR-001**: **Segurança:** a chamada ao webhook sai da plataforma em nome do usuário autenticado (a identidade não vem do navegador) e passa pelo filtro de rede da plataforma (constituição, Art. III). A URL só é alterada pela administração da plataforma.
- **NFR-002**: **LGPD:** as mensagens podem ter dados pessoais; ficam só até o fim da retenção, visíveis só ao dono, e a configuração e a limpeza ficam na auditoria.
- **NFR-003**: O passo atual e a resposta aparecem em até 1 segundo depois de chegarem do webhook.
- **NFR-004**: Interface em português do Brasil (NFR-G07), em celular e computador.

## Entidades-chave

- **Sessão do chat:** número (sequencial por usuário), dono (usuário), título, criação e data da última mensagem.
- **Mensagem do chat:** sessão, papel (usuário, assistente ou erro), texto, horário e, na resposta, o identificador da execução (quando o webhook informar).
- **Configuração do chat:** URL do webhook, tempo de retenção (dias), autenticação do webhook (tipo e segredos criptografados), quem alterou e quando.
- **Usuário:** passa a guardar o nome de usuário do provedor de identidade, para o `login` do payload.

## Critérios de sucesso

- **SC-001**: Com o chat configurado para um webhook em "Streaming" do próprio Olly Flow, um usuário de perfil Visualizador manda uma mensagem e o workflow recebe o payload com o número da sessão, `client: "chat-olly"`, o e-mail, o login e o nome dele e a mensagem; o chat mostra o passo atual e a resposta.
- **SC-002**: Duas sessões criadas por um usuário aparecem na barra lateral, como "Sessão 1" e "Sessão 2", com o histórico de cada uma depois de recarregar a página; outro usuário não as vê e tem a sua própria "Sessão 1".
- **SC-003**: Com retenção de 7 dias, uma sessão com a última mensagem de 8 dias atrás é apagada pela limpeza automática; uma sessão criada há 30 dias com uma mensagem de ontem é mantida.
- **SC-004**: Um usuário que não é administrador da plataforma não consegue ver nem alterar a configuração do chat.
- **SC-006**: A resposta real de produção do PO (relatório com títulos, listas e a tabela "Ações recomendadas") aparece com a tabela formatada (cabeçalho e linhas), e não como texto com `|`.
- **SC-005**: Uma resposta `[ { "report": "## Análise\n\n```mermaid\nflowchart LR\n  A --> B\n```" } ]` aparece com o título formatado e o flowchart desenhado (SVG) na conversa.

## Fora do escopo

- Anexos (arquivos) nas mensagens.
- Mais de um assistente (vários webhooks) ou escolha do workflow pelo usuário.
- Compartilhar sessões entre usuários; administração ver as sessões de outros usuários.
- Editar ou apagar mensagens individuais.
- Texto do modelo aos poucos (tokens): o streaming da spec 027 traz os passos.
- Envio do histórico da sessão no payload: o workflow guarda o contexto pela própria memória, usando o `chatSessionId`.

## Pré-requisitos humanos

- **PO:** responder aos pontos em aberto.
- **Workflow do assistente:** publicado, com o Webhook em modo "Streaming" (spec 027), lendo o payload desta spec. **Se usar memória, a chave DEVE combinar o `login` e o `chatSessionId`** (ex.: `{{ $json.body.login }}:{{ $json.body.chatSessionId }}`): como a numeração é por usuário, duas pessoas têm uma "sessão 1", e só o `chatSessionId` misturaria as conversas delas.
- **Segurança/Infra:** se a URL do webhook não for do próprio Olly Flow, liberar o destino no filtro de rede (`OLLY_HTTP_ALLOWLIST`).

## Pontos em aberto

Nenhum. Respondidos pelo PO em 21/10/2026:
1. **Numeração:** por usuário (cada um tem a sua "Sessão 1", "Sessão 2"…), sem reaproveitar números. O workflow combina o `login` com o `chatSessionId` na memória (pré-requisitos).
2. **Título:** "Sessão N", e depois "Sessão N · <começo da primeira mensagem>". O usuário pode renomear e excluir.
3. **Retenção:** conta a partir da última mensagem (uma mensagem nova renova o prazo); padrão de 7 dias (limites de 1 a 3650).
4. **Configuração:** nova aba **Olly Chat** na Administração.
5. **Autenticação do webhook:** opcional (nenhuma, cabeçalho com chave ou Basic).
6. **`login`:** o nome de usuário do provedor de identidade, com prioridade; senão, o e-mail.
7. **Destino:** qualquer URL HTTP ou HTTPS, respeitando o filtro de rede.
8. **Passo atual:** sim, como no chat da spec 027.

## Histórico de alterações

| Data | Alteração | Motivo |
|---|---|---|
| 21/10/2026 | Criação da spec, a pedido do PO (tela de chat da plataforma, com sessões, ligada a um workflow por webhook em streaming) | Assistente para os usuários dentro da plataforma |
| 21/10/2026 | Pontos em aberto respondidos pelo PO (numeração por usuário, renomear e excluir, retenção a partir da última mensagem com padrão de 7 dias, aba Olly Chat na Administração, autenticação opcional, `login` do IdP com prioridade, qualquer URL, passo atual). Plano e tarefas criados. Status: Planejada | Esclarecimento |
| 21/10/2026 | Nome na interface: **Olly Chat** (item do menu, título da página e aba da Administração), no lugar de "Chat" | Pedido do PO |
| 21/10/2026 | Implementação concluída ([relatório](report.md)) | — |
| 21/10/2026 | FR-005: o texto da resposta é o campo `report` (Markdown) do JSON final do workflow (lista ou objeto, com `client`, `report` e `memoria`); FR-011 e SC-005 novos: flowchart Mermaid na resposta | Detalhe informado pelo PO |
| 21/10/2026 | FR-005: o JSON final também é reconhecido quando chega como texto (o chat mostrava o JSON inteiro num workflow real) | Teste do PO em dev |
| 21/10/2026 | FR-012 e SC-006 novos: Markdown no padrão GFM (tabelas) e títulos formatados | Teste do PO com a resposta real de produção (a tabela não era formatada) |
