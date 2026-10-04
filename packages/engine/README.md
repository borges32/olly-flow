# packages/engine

Motor de execução do Olly Flow.

- `validateWorkflow`: validação estrutural (spec 002, FR-004/FR-005).
- `ExecutionState` e `runWorkflow`: execução sequencial em ordem topológica (spec 002, FR-016). A execução paralela chega na [spec 006](../../specs/006-fila-workers-paralelismo/spec.md).
