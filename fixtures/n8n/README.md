# Fixtures N8N

Workflows de referência da POC com N8N, usados como **suíte de compatibilidade** (ADR-0001): o Olly Flow precisa produzir, para a mesma entrada, a mesma saída que o N8N produziu. Os casos alimentam os testes do motor (specs 002+) e do importador (spec 012).

> Os workflows reais da POC ainda não foram exportados (pré-requisito humano do [roadmap](../../docs/roadmap.md)). Até lá existe apenas o exemplo **sintético** `exemplo-set-if`.

## Formato (FR-016 da spec 001)

Um diretório por caso, com nome em `kebab-case`:

```
fixtures/n8n/<caso>/
├── workflow.json   # exportação do N8N, sem alterações ("Download" no editor)
├── input.json      # entrada do gatilho
├── expected.json   # saída esperada por nome de nó
└── notes.md        # origem, versão do N8N e observações
```

### `workflow.json`

O JSON exportado pelo N8N (`name`, `nodes[]`, `connections`, `settings`...). **Remova credenciais e dados pessoais** antes de versionar: substitua por valores fictícios e registre no `notes.md`.

### `input.json`

```json
{
  "trigger": "Nome do nó gatilho",
  "items": [{ "json": { "campo": "valor" } }]
}
```

`items` substitui a saída do gatilho (equivale a *pin data* no gatilho). Para webhooks, o item segue o formato do N8N: `{ "json": { "headers": {}, "params": {}, "query": {}, "body": {} } }`.

### `expected.json`

Saída de cada nó relevante, indexada pelo **nome** do nó e, dentro dele, pela **porta** de saída no formato do Olly Flow (`NodeOutput`, ver [contratos](../../docs/arquitetura/contratos.md)): `main`; `true`/`false` no If; `output0..N` no Switch; `error` na porta de erro.

```json
{
  "Definir campos": { "main": [{ "json": { "nome": "Ana" } }] },
  "Maior de idade?": { "true": [{ "json": { "nome": "Ana" } }], "false": [] }
}
```

Nós omitidos não são comparados. Campos não determinísticos (datas, ids) devem ser omitidos ou explicados no `notes.md`.

### `notes.md`

Deve conter, no mínimo:

- `**Origem:**` `POC` ou `sintético`;
- `**Versão do N8N:**` versão usada para gerar a saída esperada;
- o que o caso exercita e qualquer divergência conhecida.

## Como adicionar um caso da POC

1. No N8N da POC, exporte o workflow e execute-o com uma entrada representativa.
2. Copie a entrada para `input.json` e a saída de cada nó (aba *Output*, visão JSON) para `expected.json`, convertendo para o formato por porta.
3. Anonimize dados pessoais e remova credenciais.
4. Escreva o `notes.md`. O teste `tests/fixtures.test.ts` valida a estrutura.
