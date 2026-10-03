# ADR-0004 — Runner Python em container isolado

**Status:** Proposta

- **Decisão proposta:** serviço **python-runner** (FastAPI) em container dedicado; cada execução em subprocesso sob **nsjail**, sem rede, FS somente leitura, usuário sem privilégios. Se o cluster suportar, usar **gVisor (runsc)** como camada adicional.
- **Bibliotecas:** imagem versionada com allowlist (pandas, numpy, python-dateutil...), mantida pelo time da plataforma.
- **Alternativa considerada:** Pyodide no worker (mais simples, porém com restrições de bibliotecas e desempenho).

---
Índice: [README](README.md)
