# Olly Chat (chat da plataforma)

> Spec 028. O item **Olly Chat** do menu leva a `/assistente`, onde qualquer usuário autenticado (de qualquer perfil) conversa com o assistente da organização: um workflow chamado por webhook em **Streaming** (spec 027).

## Para quem usa

- **Sessões:** ficam na barra lateral, numeradas por usuário ("Sessão 1", "Sessão 2"…) e agrupadas pela última mensagem (Hoje, Ontem, Últimos 7 dias, Anteriores). A sessão que está respondendo mostra um indicador girando.
  - **Criar:** **Nova sessão** cria a próxima; na primeira visita, uma sessão já está pronta.
  - **Título:** "Sessão N · <começo da primeira mensagem>". Renomeie pelo lápis e exclua pela lixeira (com confirmação).
  - **Número:** não é reaproveitado, nem depois de excluir.
  - **Visibilidade:** só o dono vê as próprias sessões.
- **Conversa:**
  - **Envio:** uma mensagem por vez por sessão.
  - **Espera:** o chat mostra o passo atual ("Executando: <nó>") e, no fim, a resposta, com Markdown e diagramas Mermaid.
  - **Tela:** a conversa fica numa coluna central. A pergunta aparece num balão à direita, e a resposta num cartão largo com o horário e o botão **Copiar** (copia o Markdown). Uma sessão nova dá boas-vindas com o seu nome.
  - **Histórico:** fica guardado para voltar à sessão a qualquer momento, até a retenção.
  - **Navegador fechado no meio:** a resposta é guardada mesmo assim e aparece ao voltar.
- **Retenção:** a sessão é apagada quando a última mensagem fica mais antiga que o prazo configurado (padrão 7 dias). Uma mensagem nova renova o prazo.

## Para quem configura (Administração › Olly Chat)

Só o administrador da plataforma (`project:manage` global). Cada alteração fica na auditoria (`olly_chat.config`), sem os segredos.

| Campo | Uso |
|---|---|
| URL do webhook do workflow | Qualquer URL HTTP ou HTTPS. A chamada passa pelo filtro de rede: endereços internos que não são do Olly Flow precisam estar em `OLLY_HTTP_ALLOWLIST` |
| Retenção das sessões (dias) | De 1 a 3650 (padrão 7), contados a partir da última mensagem |
| Autenticação do webhook | Nenhuma, cabeçalho com chave (nome e valor) ou Basic Auth (usuário e senha). Os segredos ficam criptografados e não voltam à tela: em branco, mantêm o atual |

Sem URL configurada, a página do chat avisa que ele não está disponível.

## Para quem monta o workflow do assistente

1. **Webhook** com **Método** `POST` e **Responder:** `streaming` (spec 027); publique o workflow.
2. **Payload** que o Olly Flow envia (montado pela API com o usuário logado; a página não consegue alterar a identidade):

   ```json
   {
     "chatSessionId": "5",
     "client": "chat-olly",
     "email": "alexandre.b.fernandes@bradesco.com.br",
     "login": "alexandre.b.fernandes@bradesco.com.br",
     "name": "ALEXANDRE B. FERNANDES",
     "message": "Analise se estamos com algum problema com o mobile pf"
   }
   ```

   - `chatSessionId`: o número da sessão do usuário, como texto;
   - `login`: o nome de usuário do provedor de identidade (`preferred_username`), quando a pessoa entra pelo IdP; senão, o e-mail;
   - no workflow, os campos estão em `$json.body` (ex.: `{{ $json.body.message }}`).
3. **Memória:** como cada usuário tem a sua "Sessão 1", a chave da memória (ex.: `memory.postgres`) **deve combinar o login e a sessão**, por exemplo `={{ $json.body.login }}:{{ $json.body.chatSessionId }}`. Só o `chatSessionId` misturaria as conversas de pessoas diferentes.
4. **Resposta:** o workflow termina com um JSON (o último nó ou o **Responder ao Webhook**), em lista ou objeto:

   ```json
   [ { "client": "chat-olly", "report": "## Mobile PF\n\nSem incidentes…", "memoria": {} } ]
   ```

   - **Texto exibido:** o campo `report`, em Markdown no padrão do GitHub (GFM): títulos, listas, **tabelas**, tachado, links, citações e linhas horizontais. Tabelas largas rolam na horizontal dentro da mensagem. HTML bruto não é interpretado. Os outros campos (`client`, `memoria`…) não aparecem no chat.
   - **JSON como texto:** também funciona, por exemplo no **Responder ao Webhook** em "Texto" ou num Agent cujo `output` é esse JSON (com ou sem um bloco ```json em volta).
   - **Sem `report`:** vale o `output` (Agent) ou o `text` (Basic LLM Chain); senão, o JSON formatado.
   - **Passo atual:** vem dos nomes dos nós executados.
   - **Diagramas:** um bloco ` ```mermaid ` no `report` vira diagrama (ao menos `flowchart`). Com a sintaxe inválida, o chat mostra o código e o aviso, e o resto da mensagem aparece normalmente:

     ````markdown
     ```mermaid
     flowchart LR
       A[App] --> B[API] --> C[(Banco)]
     ```
     ````
5. **Webhooks fora do Olly Flow** (ex.: N8N com streaming): funcionam se responderem no formato da spec 027 ou de uma vez, em JSON ou texto (sem o passo atual).

## API

| Rota | Permissão | Uso |
|---|---|---|
| `GET /api/v1/olly-chat/status` | autenticado | `{ configured }` |
| `GET`/`POST /api/v1/olly-chat/sessions` | autenticado | Listar e criar sessões (só as próprias) |
| `PATCH`/`DELETE /api/v1/olly-chat/sessions/:id` | autenticado | Renomear (`{ title }`) e excluir |
| `GET /api/v1/olly-chat/sessions/:id/messages` | autenticado | Histórico |
| `POST /api/v1/olly-chat/sessions/:id/messages` | autenticado | `{ message }`; resposta em NDJSON (formato da spec 027); 409 com a sessão ainda respondendo ou sem configuração |
| `GET`/`PUT /api/v1/admin/olly-chat` | `project:manage` (global) | Configuração, sem segredos |
