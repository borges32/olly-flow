# exemplo-chat-trigger

- **Origem:** sintético (spec 021; não veio da POC)
- **Versão do N8N:** 1.x (Chat Trigger 1.1, AI Agent 1.7, OpenAI Chat Model 1.2, Postgres Chat Memory 1.3)

Cobre a importação do Chat Trigger (spec 021, FR-011, FR-012, SC-004):
- **Chat Trigger:** chat público hospedado, com título, subtítulo, mensagens iniciais, arquivos PDF e a sessão anterior carregada da memória. O `webhookId` do nó mantém a URL (`/webhook/<webhookId>/chat`).
- **AI Agent:** prompt automático ("Connected Chat Trigger Node"), que vira o prompt do item (`chatInput`).
- **Postgres Chat Memory:** ligada ao Agent e ao gatilho; vira a memória persistente da plataforma.

As credenciais (`openAiApi` e `postgres`) são fictícias. Sem credenciais equivalentes no projeto de destino, a importação deixa pendências e o caso não é executado. Por isso o `expected.json` é vazio (`{}`): nenhum nó é comparado, e as respostas do modelo não seriam determinísticas.
