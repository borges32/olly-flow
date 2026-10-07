# ADR-0008 — Provedor de LLM e camada de IA

**Status:** Aceita — **Data**: 04/10/2026

- **Decisão:** nós de IA construídos sobre **LangChain.js / LangGraph.js**, com provedor de LLM **configurável por credencial** (não acoplar a um único fornecedor). MCP via SDK oficial `@modelcontextprotocol/sdk`.
- **Decisão:** Permitir modelos da Open AI, Claude, Google
- **Complemento (07/10/2026, PO):** a **Bridge**, gateway interno de IA da instituição, entra como um **modelo de chat customizado** (nó próprio, [spec 016](../../specs/016-nos-bridge-agentix/spec.md)), e não como um novo fornecedor desta lista.

---
Índice: [README](README.md)
