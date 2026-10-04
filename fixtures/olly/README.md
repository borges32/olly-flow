# Fixtures no formato Olly Flow

Equivalentes, no formato interno (`WorkflowDefinition`), dos casos de [`fixtures/n8n/`](../n8n/README.md). Cada `<caso>/workflow.json` é executado pelo motor com o `input.json` do caso N8N, e a saída é comparada com o `expected.json` de lá (teste `packages/engine/src/fixtures.test.ts`).

Enquanto o importador N8N não existe (spec 012), a conversão é manual. Use os mesmos **nomes de nó** do workflow N8N: a comparação é feita por nome.
