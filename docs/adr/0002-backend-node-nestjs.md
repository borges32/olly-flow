# ADR-0002 — Backend em Node.js + TypeScript com NestJS

**Status:** Proposta

- **Contexto:** o motor de expressões e o nó de código JS precisam ser compatíveis com o N8N (ADR-0001), que é Node/TS; o frontend é React/TS.
- **Decisão proposta:** API, motor e workers em **Node.js 22 LTS + TypeScript**, usando **NestJS** (módulos, injeção de dependência e *guards* que facilitam o RBAC). Monorepo com **pnpm workspaces + Turborepo**. Tipos compartilhados entre front e back.
- **Alternativa considerada:** Fastify puro (mais leve, porém exige montar a estrutura de módulos/guards manualmente).

---
Índice: [README](README.md)
