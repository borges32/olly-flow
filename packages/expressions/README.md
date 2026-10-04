# packages/expressions

Expressões `{{ }}` compatíveis com o N8N ([spec 003](../../specs/003-expressoes-execucao-teste/spec.md), [docs/expressoes.md](../../docs/expressoes.md)).

- `@olly/expressions`: parser de templates, coleta de expressões nos parâmetros, detecção de referências a nós, tipos do contrato de avaliação. Código puro, sem dependências nativas.
- `@olly/expressions/isolate`: `IsolateEvaluator`, que avalia em lote dentro de um isolate V8 (isolated-vm, ADR-0003). Só deve ser carregado pelo `apps/task-runner` (processo separado) e pelos testes.
