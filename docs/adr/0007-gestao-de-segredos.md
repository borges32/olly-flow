# ADR-0007 — Gestão de segredos

**Status:** Proposta — **depende de informação da instituição**

- **Decisão proposta:** credenciais dos workflows criptografadas com **AES-256-GCM** (envelope encryption), com a chave mestra em **HashiCorp Vault** ou no KMS da nuvem já usada pela instituição. Rotação de chave suportada via `key_version`.
- **Pendência:** confirmar se já existe Vault/KMS corporativo.

---
Índice: [README](README.md)
