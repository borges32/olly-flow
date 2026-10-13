# exemplo-output-parsers

- **Origem:** sintético (spec 018; não veio da POC)
- **Versão do N8N:** 1.x (AI Agent 1.7, Basic LLM Chain 1.7, Structured Output Parser 1.2, Auto-fixing 1, Item List 1)

Cobre a migração dos output parsers (spec 018, FR-008 a FR-010):
- **AI Agent:** com "Require Specific Output Format" e um **Auto-fixing Output Parser**, que tem o próprio modelo e um **Structured Output Parser** (a partir de um exemplo JSON) em cadeia;
- **Basic LLM Chain:** com um **Item List Output Parser** (3 itens).

As credenciais (`openAiApi`, "OpenAi account") são fictícias. Sem credenciais equivalentes no projeto de destino, a importação deixa pendências e o caso não é executado (não há `expected.json`): o objetivo é a importação sem nós marcadores (SC-005).
