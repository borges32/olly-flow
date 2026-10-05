# exemplo-webhook-code

- **Origem:** sintético (criado na spec 005 enquanto os workflows reais da POC não são exportados; não substitui as fixtures reais, e o SC-001 da spec 005 continua pendente)
- **Versão do N8N:** 1.x (nós Webhook v2 e Code v2)

Exercita o item do webhook (`body`) e o Code node em "Run Once for All Items", com `$input.first()` e retorno de array de `{ json }`. A saída esperada foi calculada à mão (2 × 5 + 3 × 10 = 40).
