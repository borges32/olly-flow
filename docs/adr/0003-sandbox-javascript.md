# ADR-0003 — Sandbox JavaScript com isolated-vm em task runner separado

**Status:** Aceita · **Data:** 03/10/2026

- **Decisão:** código JS de usuário e avaliação de expressões rodam em **isolated-vm** dentro de um **processo task runner** separado do worker, com limites de memória (128 MB) e tempo (30 s para código, 100 ms para expressões).
- **Motivo:** isolamento real de V8; o `vm2` foi descontinuado por vulnerabilidades de escape. Processo separado limita o impacto de uma eventual falha.

---
Índice: [README](README.md)
